// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "TolariaCrashPrivacy",
  platforms: [.macOS(.v13), .iOS(.v15)],
  dependencies: [.package(url: "https://github.com/getsentry/sentry-cocoa.git", exact: "8.58.0")],
  targets: [
    .target(name: "TolariaCrashPrivacy", dependencies: [.product(name: "Sentry", package: "sentry-cocoa")],
      path: "ios", exclude: ["TolariaCrashReportingModule.swift", "TolariaCrashReporting.podspec", "PrivacyInfo.xcprivacy"]),
    .testTarget(name: "TolariaCrashPrivacyTests", dependencies: ["TolariaCrashPrivacy"], path: "tests"),
  ]
)
