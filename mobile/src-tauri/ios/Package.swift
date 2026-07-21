// swift-tools-version:5.9

import PackageDescription

let package = Package(
  name: "nativebilling",
  platforms: [.iOS(.v15)],
  products: [
    .library(
      name: "nativebilling",
      type: .static,
      targets: ["nativebilling"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "nativebilling",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
