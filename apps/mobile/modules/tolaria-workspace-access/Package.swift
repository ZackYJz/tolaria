// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "TolariaWorkspaceFiles",
  platforms: [.macOS(.v13), .iOS(.v15)],
  targets: [
    .target(
      name: "TolariaWorkspaceFiles",
      path: "ios",
      exclude: ["TolariaWorkspaceAccessModule.swift", "TolariaWorkspaceAccess.podspec"],
      sources: ["WorkspaceFileSafety.swift", "CoordinatedWorkspaceFile.swift", "WorkspaceBookmarkStore.swift", "WorkspaceFileNativeProof.swift", "WorkspaceFileIndex.swift", "ManagedWorkspaceImport.swift", "WorkspaceTextRecovery.swift", "WorkspaceTextRecord.swift", "ManagedWorkspaceText.swift", "WorkspaceTextRecoveryNativeProof.swift", "WorkspaceEntryFingerprint.swift", "WorkspaceMutationCoordination.swift", "WorkspaceEntryRecovery.swift", "WorkspaceEntryNativeProof.swift", "ManagedWorkspacePath.swift", "WorkspaceGitMetadata.swift", "LinkedWorkspacePlan.swift", "LinkedWorkspaceTree.swift", "LinkedWorkspaceSession.swift", "LinkedWorkspaceStore.swift", "WorkspaceBackgroundLease.swift", "LinkedConflictPlan.swift", "LinkedConflictReview.swift", "LinkedConflictPublication.swift"]
    ),
    .testTarget(name: "TolariaWorkspaceFilesTests", dependencies: ["TolariaWorkspaceFiles"], path: "tests"),
  ]
)
