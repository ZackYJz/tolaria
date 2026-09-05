use regex::Regex;
use reqwest::Url;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;

const MAX_HTML_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct BookmarkMetadata {
    url: String,
    title: String,
    description: String,
    image: String,
    favicon: String,
}

#[tauri::command]
pub async fn get_bookmark_metadata(url: String) -> Result<BookmarkMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_metadata(&url))
        .await
        .map_err(|_| "Bookmark metadata worker failed".to_string())?
}

fn fetch_metadata(url: &str) -> Result<BookmarkMetadata, String> {
    let (response, final_url) = crate::vault::fetch_public_response(url)?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !content_type.starts_with("text/html") && !content_type.starts_with("application/xhtml+xml")
    {
        return Err("Bookmark URL did not return an HTML page".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_HTML_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read bookmark page".to_string())?;
    if bytes.len() as u64 > MAX_HTML_BYTES {
        return Err("Bookmark page exceeds 2 MiB".to_string());
    }
    Ok(parse_metadata(&String::from_utf8_lossy(&bytes), &final_url))
}

fn decode_entities(value: &str) -> String {
    let entities = Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|amp|quot|apos|lt|gt|nbsp);").unwrap();
    entities
        .replace_all(value, |captures: &regex::Captures<'_>| {
            let entity = &captures[1];
            let decoded = match entity {
                "amp" => Some('&'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "nbsp" => Some(' '),
                _ => entity
                    .strip_prefix("#x")
                    .and_then(|digits| u32::from_str_radix(digits, 16).ok())
                    .or_else(|| {
                        entity
                            .strip_prefix('#')
                            .and_then(|digits| digits.parse().ok())
                    })
                    .and_then(char::from_u32),
            };
            decoded
                .map(|ch| ch.to_string())
                .unwrap_or_else(|| captures[0].to_string())
        })
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn asset_url(base: &Url, value: &str) -> String {
    base.join(value)
        .ok()
        .filter(|url| crate::vault::validate_public_http_url(url).is_ok())
        .map(|url| url.to_string())
        .unwrap_or_default()
}

fn parse_metadata(html: &str, url: &Url) -> BookmarkMetadata {
    // Read only metadata tags, never execute or render the retrieved page.
    let hidden =
        Regex::new(r"(?is)<!--.*?-->|<script\b[^>]*>.*?</script\s*>|<style\b[^>]*>.*?</style\s*>")
            .unwrap();
    let html = hidden.replace_all(html, "");
    let tags = Regex::new(r#"(?is)<(meta|link)\b(?:[^>"']|"[^"]*"|'[^']*')*>"#).unwrap();
    let attributes =
        Regex::new(r#"(?is)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#).unwrap();
    let mut metadata = HashMap::new();
    let mut favicon = String::new();
    for tag in tags.captures_iter(&html) {
        let attrs: HashMap<_, _> = attributes
            .captures_iter(&tag[0])
            .map(|attr| {
                let value = (2..=4)
                    .find_map(|index| attr.get(index))
                    .map_or("", |value| value.as_str());
                (attr[1].to_ascii_lowercase(), decode_entities(value))
            })
            .collect();
        if tag[1].eq_ignore_ascii_case("meta") {
            if let (Some(key), Some(value)) = (
                attrs.get("property").or_else(|| attrs.get("name")),
                attrs.get("content"),
            ) {
                if !value.is_empty() {
                    metadata
                        .entry(key.to_ascii_lowercase())
                        .or_insert_with(|| value.clone());
                }
            }
        } else if attrs.get("rel").is_some_and(|rel| {
            rel.split_whitespace()
                .any(|word| word.eq_ignore_ascii_case("icon"))
        }) {
            if let Some(href) = attrs.get("href") {
                favicon = asset_url(url, href);
            }
        }
    }
    let lookup = |keys: &[&str]| {
        keys.iter()
            .find_map(|key| metadata.get(*key))
            .cloned()
            .unwrap_or_default()
    };
    let mut title = lookup(&["og:title", "twitter:title"]);
    if title.is_empty() {
        title = Regex::new(r"(?is)<title\b[^>]*>(.*?)</title\s*>")
            .unwrap()
            .captures(&html)
            .map(|capture| decode_entities(&capture[1]))
            .unwrap_or_default();
    }
    if title.is_empty() {
        title = url.host_str().unwrap_or(url.as_str()).to_string();
    }
    let image = lookup(&["og:image", "twitter:image"]);
    BookmarkMetadata {
        url: url.to_string(),
        title,
        description: lookup(&["og:description", "description", "twitter:description"]),
        image: if image.is_empty() {
            String::new()
        } else {
            asset_url(url, &image)
        },
        favicon: if favicon.is_empty() {
            asset_url(url, "/favicon.ico")
        } else {
            favicon
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_public_or_executable_urls_before_requesting() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "http://127.0.0.1",
            "http://localhost",
            "https://user:password@example.com",
        ] {
            assert!(fetch_metadata(url).is_err(), "accepted {url}");
        }
    }

    #[test]
    fn omits_explicit_private_network_assets() {
        for image in [
            "http://127.0.0.1/admin",
            "http://localhost/icon",
            "http://192.168.1.1/image",
            "http://[::1]/image",
            "https://device.local/image",
        ] {
            let html = format!(
                r#"<meta property="og:image" content="{image}"><link rel="icon" href="{image}">"#
            );
            let metadata = parse_metadata(&html, &Url::parse("https://example.com").unwrap());
            assert!(metadata.image.is_empty(), "accepted {image}");
            assert_eq!(metadata.favicon, "https://example.com/favicon.ico");
        }
    }

    #[test]
    fn extracts_social_metadata_and_resolves_relative_images() {
        let html = r#"<title>Fallback</title><meta content='A &amp; B' property='og:title'><meta name=description content='Helpful &#x4e66; page'><meta property='og:image' content='/preview.png'><link href='/icon.svg' rel='shortcut icon'>"#;
        let metadata = parse_metadata(
            html,
            &reqwest::Url::parse("https://example.com/docs").unwrap(),
        );
        assert_eq!(metadata.title, "A & B");
        assert_eq!(metadata.description, "Helpful 书 page");
        assert_eq!(metadata.image, "https://example.com/preview.png");
        assert_eq!(metadata.favicon, "https://example.com/icon.svg");
    }

    #[test]
    fn rejects_unsafe_assets_and_uses_title_fallback() {
        let html =
            r#"<title> My\n page </title><meta property="og:image" content="javascript:alert(1)">"#;
        let metadata = parse_metadata(html, &reqwest::Url::parse("https://example.com").unwrap());
        assert_eq!(metadata.title, "My\\n page");
        assert_eq!(metadata.image, "");
        assert_eq!(metadata.favicon, "https://example.com/favicon.ico");
    }

    #[test]
    fn ignores_metadata_in_comments_and_scripts() {
        let html = r#"<!-- <meta property="og:title" content="Wrong"> --><script>const x = '<meta property="og:title" content="Wrong">';</script><title>Right</title>"#;
        let metadata = parse_metadata(html, &reqwest::Url::parse("https://example.com").unwrap());
        assert_eq!(metadata.title, "Right");
    }
}
