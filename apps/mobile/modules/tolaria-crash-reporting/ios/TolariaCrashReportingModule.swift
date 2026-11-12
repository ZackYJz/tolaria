import ExpoModulesCore

public final class TolariaCrashReportingModule: Module {
  private let reporter = NativeCrashReporter()

  public func definition() -> ModuleDefinition {
    Name("TolariaCrashReporting")
    Function("start") { (dsn: String, metadata: [String: String]) in
      try self.reporter.start(dsn: dsn, metadata: metadata)
    }
    Function("stop") { self.reporter.stop() }
  }
}
