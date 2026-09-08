use super::image::prepare_attachment_path;
use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE, LOCATION};
use reqwest::{StatusCode, Url};
use std::fs;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs};
use std::path::Path;
use std::time::Duration;

const FAKE_IP_V4_NETWORK: u32 = 0xc612_0000;
const FAKE_IP_V4_MASK: u32 = 0xfffe_0000;
const DNS_BOOTSTRAP_HOST: &str = "cloudflare-dns.com";
const MAX_DNS_RESPONSE_BYTES: u64 = 64 * 1024;
const MAX_IMAGE_BYTES: u64 = 15 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const NON_PUBLIC_IPV4_RANGES: [(u32, u32); 13] = [
    (0x0000_0000, 0xff00_0000),
    (0x0a00_0000, 0xff00_0000),
    (0x6440_0000, 0xffc0_0000),
    (0x7f00_0000, 0xff00_0000),
    (0xa9fe_0000, 0xffff_0000),
    (0xac10_0000, 0xfff0_0000),
    (0xc000_0000, 0xffff_ff00),
    (0xc000_0200, 0xffff_ff00),
    (0xc0a8_0000, 0xffff_0000),
    (0xc612_0000, 0xfffe_0000),
    (0xc633_6400, 0xffff_ff00),
    (0xcb00_7100, 0xffff_ff00),
    (0xe000_0000, 0xe000_0000),
];

#[derive(Clone, Copy)]
struct FailureReason(&'static str);

#[derive(Clone, Copy)]
struct ImageContentType<'a>(&'a str);

#[derive(Clone, Copy)]
struct ImageExtension(&'static str);

struct RemoteUrlInput(String);

impl RemoteUrlInput {
    fn new(value: &str) -> Self {
        Self(value.to_string())
    }
}

fn remote_image_error(reason: FailureReason) -> String {
    format!("Remote image import failed: {}", reason.0)
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let value = u32::from(ip);
    !NON_PUBLIC_IPV4_RANGES
        .iter()
        .any(|(network, mask)| value & mask == *network)
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => is_public_ipv4(ipv4),
        IpAddr::V6(ipv6) => {
            if let Some(ipv4) = ipv6.to_ipv4_mapped() {
                return is_public_ipv4(ipv4);
            }
            let segments = ipv6.segments();
            let global_unicast = segments[0] & 0xe000 == 0x2000;
            let documentation = segments[0] == 0x2001 && segments[1] == 0x0db8;
            global_unicast && !documentation
        }
    }
}

fn has_disallowed_credentials(url: &Url) -> bool {
    !url.username().is_empty() || url.password().is_some()
}

fn is_local_hostname(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
}

fn validate_literal_host(host: &str) -> Result<(), String> {
    if host
        .parse::<IpAddr>()
        .is_ok_and(|address| !is_public_ip(address))
    {
        return Err(remote_image_error(FailureReason(
            "private hosts are not allowed",
        )));
    }
    Ok(())
}

fn validate_remote_image_url(input: RemoteUrlInput) -> Result<Url, String> {
    let url = Url::parse(&input.0).map_err(|_| remote_image_error(FailureReason("invalid URL")))?;
    validate_public_http_url(&url)?;
    Ok(url)
}

fn validate_remote_url_protocol(url: &Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(remote_image_error(FailureReason("unsupported URL scheme")));
    }
    if has_disallowed_credentials(url) {
        return Err(remote_image_error(FailureReason(
            "URL credentials are not allowed",
        )));
    }
    Ok(())
}

fn validate_remote_url_host(url: &Url) -> Result<(), String> {
    let raw_host = url
        .host_str()
        .ok_or_else(|| remote_image_error(FailureReason("URL host is missing")))?;
    let host = raw_host.trim_matches(['[', ']']);
    if is_local_hostname(host) {
        return Err(remote_image_error(FailureReason(
            "local hosts are not allowed",
        )));
    }
    validate_literal_host(host)
}

fn resolved_public_address(url: &Url) -> Result<SocketAddr, String> {
    let raw_host = url
        .host_str()
        .ok_or_else(|| remote_image_error(FailureReason("URL host is missing")))?;
    let host = raw_host.trim_matches(['[', ']']);
    let port = url
        .port_or_known_default()
        .ok_or_else(|| remote_image_error(FailureReason("URL port is missing")))?;
    let addresses: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|_| remote_image_error(FailureReason("host lookup failed")))?
        .collect();
    select_public_address(host, port, &addresses, resolve_public_dns)
}

fn select_public_address(
    host: &str,
    port: u16,
    addresses: &[SocketAddr],
    fallback: impl FnOnce(&str) -> Result<IpAddr, String>,
) -> Result<SocketAddr, String> {
    if let Some(address) = addresses.iter().find(|address| is_public_ip(address.ip())) {
        return Ok(*address);
    }
    // Clash TUN uses the benchmarking range for synthetic DNS answers. Never
    // connect to these addresses: resolve the hostname independently instead.
    let has_fake_ip = !addresses.is_empty()
        && addresses.iter().all(|address| match address.ip() {
            IpAddr::V4(ip) => u32::from(ip) & FAKE_IP_V4_MASK == FAKE_IP_V4_NETWORK,
            IpAddr::V6(_) => false,
        });
    if has_fake_ip && host.parse::<IpAddr>().is_err() {
        let ip = fallback(host)?;
        if is_public_ip(ip) {
            return Ok(SocketAddr::new(ip, port));
        }
    }
    Err(remote_image_error(FailureReason(
        "host is not publicly routable",
    )))
}

fn resolve_public_dns(host: &str) -> Result<IpAddr, String> {
    let bootstrap = SocketAddr::from(([1, 1, 1, 1], 443));
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .resolve(DNS_BOOTSTRAP_HOST, bootstrap)
        .build()
        .map_err(|_| remote_image_error(FailureReason("secure DNS client setup failed")))?;
    // The URL keeps the provider hostname for certificate verification and SNI;
    // the fixed bootstrap address avoids asking the same synthetic DNS again.
    let response = client
        .get("https://cloudflare-dns.com/dns-query")
        .query(&[("name", host), ("type", "A")])
        .header(reqwest::header::ACCEPT, "application/dns-json")
        .send()
        .and_then(Response::error_for_status)
        .map_err(|_| remote_image_error(FailureReason("secure DNS request failed")))?;
    let mut bytes = Vec::new();
    response
        .take(MAX_DNS_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| remote_image_error(FailureReason("secure DNS response failed")))?;
    if bytes.len() as u64 > MAX_DNS_RESPONSE_BYTES {
        return Err(remote_image_error(FailureReason(
            "secure DNS response too large",
        )));
    }
    parse_public_dns_answer(&bytes)
}

fn parse_public_dns_answer(bytes: &[u8]) -> Result<IpAddr, String> {
    let response: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|_| remote_image_error(FailureReason("invalid secure DNS response")))?;
    if response.get("Status").and_then(serde_json::Value::as_u64) != Some(0)
        || response.get("TC").and_then(serde_json::Value::as_bool) != Some(false)
    {
        return Err(remote_image_error(FailureReason(
            "secure DNS lookup failed",
        )));
    }
    response
        .get("Answer")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|answer| answer.get("type").and_then(serde_json::Value::as_u64) == Some(1))
        .filter_map(|answer| answer.get("data")?.as_str()?.parse::<Ipv4Addr>().ok())
        .map(IpAddr::V4)
        .find(|ip| is_public_ip(*ip))
        .ok_or_else(|| remote_image_error(FailureReason("secure DNS has no public IPv4 answer")))
}

fn client_for(url: &Url) -> Result<Client, String> {
    let raw_host = url
        .host_str()
        .ok_or_else(|| remote_image_error(FailureReason("URL host is missing")))?;
    let host = raw_host.trim_matches(['[', ']']);
    let address = resolved_public_address(url)?;
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent("Tolaria remote image importer")
        .resolve(host, address)
        .build()
        .map_err(|_| remote_image_error(FailureReason("HTTP client setup failed")))
}

fn redirected_url(response: &Response, current_url: &Url) -> Result<Option<Url>, String> {
    if !response.status().is_redirection() {
        return Ok(None);
    }
    let location = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| remote_image_error(FailureReason("redirect location is invalid")))?;
    let next_url = current_url
        .join(location)
        .map_err(|_| remote_image_error(FailureReason("redirect URL is invalid")))?;
    validate_remote_image_url(RemoteUrlInput::new(next_url.as_str())).map(Some)
}

pub(crate) fn validate_public_http_url(url: &Url) -> Result<(), String> {
    validate_remote_url_protocol(url)?;
    validate_remote_url_host(url)
}

pub(crate) fn fetch_public_response(url: &str) -> Result<(Response, Url), String> {
    fetch_response(RemoteUrlInput::new(url))
}

fn fetch_response(input: RemoteUrlInput) -> Result<(Response, Url), String> {
    let mut url = validate_remote_image_url(input)?;
    for redirect_count in 0..=MAX_REDIRECTS {
        let response = request_url(&url)?;
        if let Some(next_url) = redirected_url(&response, &url)? {
            if redirect_count == MAX_REDIRECTS {
                return Err(remote_image_error(FailureReason("too many redirects")));
            }
            url = next_url;
            continue;
        }
        if response.status() != StatusCode::OK {
            return Err(remote_image_error(FailureReason(
                "server returned an error",
            )));
        }
        return Ok((response, url));
    }
    Err(remote_image_error(FailureReason("too many redirects")))
}

fn request_url(url: &Url) -> Result<Response, String> {
    client_for(url)?
        .get(url.clone())
        .send()
        .map_err(|_| remote_image_error(FailureReason("request failed")))
}

fn extension_for_content_type(content_type: ImageContentType<'_>) -> Option<ImageExtension> {
    let extension = match content_type
        .0
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" | "image/x-ms-bmp" => Some("bmp"),
        "image/tiff" => Some("tiff"),
        _ => None,
    }?;
    Some(ImageExtension(extension))
}

fn downloaded_filename(url: &Url, extension: ImageExtension) -> String {
    let source_name = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|name| !name.is_empty())
        .unwrap_or("remote-image");
    let stem = Path::new(source_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("remote-image");
    format!("{stem}.{}", extension.0)
}

fn read_image_bytes(response: &mut Response) -> Result<Vec<u8>, String> {
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|length| length > MAX_IMAGE_BYTES)
    {
        return Err(remote_image_error(FailureReason("image is too large")));
    }

    let mut bytes = Vec::new();
    response
        .take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| remote_image_error(FailureReason("response could not be read")))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(remote_image_error(FailureReason("image is too large")));
    }
    Ok(bytes)
}

pub fn download_remote_image(vault_path: &str, raw_url: &str) -> Result<String, String> {
    let (mut response, final_url) = fetch_response(RemoteUrlInput::new(raw_url))?;
    let extension = response_image_extension(&response)?;
    let bytes = read_image_bytes(&mut response)?;
    save_downloaded_image(vault_path, &final_url, extension, bytes)
}

fn response_image_extension(response: &Response) -> Result<ImageExtension, String> {
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| remote_image_error(FailureReason("response is not an image")))?;
    let extension = extension_for_content_type(ImageContentType(content_type))
        .ok_or_else(|| remote_image_error(FailureReason("response is not a supported image")))?;
    Ok(extension)
}

fn save_downloaded_image(
    vault_path: &str,
    final_url: &Url,
    extension: ImageExtension,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let filename = downloaded_filename(final_url, extension);
    let target_path = prepare_attachment_path(vault_path, &filename)?;
    fs::write(&target_path, bytes)
        .map_err(|_| remote_image_error(FailureReason("attachment could not be written")))?;
    Ok(target_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn remote_image_urls_require_public_http_hosts() {
        assert!(validate_remote_image_url(RemoteUrlInput::new(
            "https://images.example.com/photo.png"
        ))
        .is_ok());
        assert!(
            validate_remote_image_url(RemoteUrlInput::new("http://127.0.0.1/photo.png")).is_err()
        );
        assert!(validate_remote_image_url(RemoteUrlInput::new("http://[::1]/photo.png")).is_err());
        for address in [
            "0.0.0.1",
            "100.64.0.1",
            "192.0.2.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "2001:db8::1",
            "fec0::1",
        ] {
            assert!(!is_public_ip(address.parse().expect("valid test address")));
        }
        assert!(is_public_ip("8.8.8.8".parse().expect("valid IPv4")));
        assert!(is_public_ip(
            "2606:4700:4700::1111".parse().expect("valid IPv6")
        ));
        assert!(validate_remote_image_url(RemoteUrlInput::new("file:///tmp/photo.png")).is_err());
        assert!(validate_remote_image_url(RemoteUrlInput::new(
            "https://user:secret@example.com/photo.png"
        ))
        .is_err());
    }

    #[test]
    fn private_and_link_local_addresses_are_never_download_targets() {
        assert!(!is_public_ip(IpAddr::V4(Ipv4Addr::new(10, 1, 2, 3))));
        assert!(!is_public_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 1, 2))));
        assert!(!is_public_ip(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(!is_public_ip("fd00::1".parse().unwrap()));
        assert!(is_public_ip(IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))));
    }

    #[test]
    fn image_content_types_choose_safe_file_extensions() {
        assert_eq!(
            extension_for_content_type(ImageContentType("image/png")).map(|value| value.0),
            Some("png")
        );
        assert_eq!(
            extension_for_content_type(ImageContentType("image/jpeg; charset=binary"))
                .map(|value| value.0),
            Some("jpg")
        );
        assert_eq!(
            extension_for_content_type(ImageContentType("image/svg+xml")).map(|value| value.0),
            None
        );
        assert_eq!(
            extension_for_content_type(ImageContentType("text/html")).map(|value| value.0),
            None
        );
    }

    #[test]
    fn downloaded_filenames_do_not_trust_url_extensions() {
        let url = reqwest::Url::parse("https://example.com/assets/hero.php?format=png").unwrap();
        assert_eq!(downloaded_filename(&url, ImageExtension("png")), "hero.png");

        let url = reqwest::Url::parse("https://example.com/").unwrap();
        assert_eq!(
            downloaded_filename(&url, ImageExtension("webp")),
            "remote-image.webp"
        );
    }
}

#[cfg(test)]
mod fake_ip_tests {
    use super::*;

    #[test]
    fn only_fake_ip_dns_answers_trigger_fallback() {
        for ip in ["198.18.0.1", "198.19.255.254"] {
            let address = format!("{ip}:443").parse().unwrap();
            let resolved = select_public_address("example.com", 443, &[address], |_| {
                Ok("1.1.1.1".parse().unwrap())
            })
            .unwrap();
            assert_eq!(resolved, "1.1.1.1:443".parse().unwrap());
        }
        for ip in ["198.17.255.255", "198.20.0.0", "127.0.0.1", "10.1.2.3"] {
            let address = format!("{ip}:443").parse().unwrap();
            let _ = select_public_address("example.com", 443, &[address], |_| {
                panic!("unexpected fallback for {ip}")
            });
        }
    }

    #[test]
    fn ordinary_public_answers_win_and_literal_fake_ips_stay_blocked() {
        let answers = [
            "198.18.0.1:443".parse().unwrap(),
            "1.1.1.1:443".parse().unwrap(),
        ];
        assert_eq!(
            select_public_address("example.com", 443, &answers, |_| panic!(
                "normal DNS needs no fallback"
            ))
            .unwrap(),
            answers[1]
        );
        assert!(validate_remote_image_url(RemoteUrlInput::new("https://198.18.0.1")).is_err());
        assert!(
            select_public_address("198.18.0.1", 443, &answers[..1], |_| panic!(
                "literal addresses must not use DNS"
            ))
            .is_err()
        );
    }

    #[test]
    fn dns_fallback_fails_closed_for_errors_and_non_public_answers() {
        let mixed = [
            "198.18.0.1:443".parse().unwrap(),
            "10.0.0.1:443".parse().unwrap(),
        ];
        assert!(
            select_public_address("example.com", 443, &mixed, |_| panic!(
                "mixed private DNS must not trigger fallback"
            ))
            .is_err()
        );
        assert!(parse_public_dns_answer(
            br#"{"Status":0,"TC":true,"Answer":[{"type":1,"data":"1.1.1.1"}]}"#
        )
        .is_err());
        let answers = ["198.18.0.1:443".parse().unwrap()];
        assert!(select_public_address("example.com", 443, &answers, |_| Err(
            "lookup failed".into()
        ))
        .is_err());
        assert!(
            select_public_address("example.com", 443, &answers, |_| Ok("127.0.0.1"
                .parse()
                .unwrap()))
            .is_err()
        );
        assert!(select_public_address("example.com", 443, &[], |_| panic!(
            "empty DNS is not fake IP"
        ))
        .is_err());
        for json in [
            r#"{"Status":3}"#,
            r#"{"Status":0,"TC":false,"Answer":[]}"#,
            r#"{"Status":0,"TC":false,"Answer":[{"type":1,"data":"10.0.0.1"}]}"#,
            r#"{"Status":0,"TC":false,"Answer":[{"type":5,"data":"1.1.1.1"}]}"#,
            "invalid",
        ] {
            assert!(parse_public_dns_answer(json.as_bytes()).is_err());
        }
        assert_eq!(
            parse_public_dns_answer(
                br#"{"Status":0,"TC":false,"Answer":[{"type":1,"data":"104.21.4.112"}]}"#
            )
            .unwrap(),
            "104.21.4.112".parse::<IpAddr>().unwrap()
        );
    }
}
