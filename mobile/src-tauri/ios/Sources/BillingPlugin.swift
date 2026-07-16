import Foundation
import StoreKit
import SwiftRs
import Tauri
import UIKit

private enum BillingError: LocalizedError {
  case unverified

  var errorDescription: String? {
    switch self {
    case .unverified:
      return "購入情報を検証できませんでした"
    }
  }
}

private struct BillingTransactionPayload: Encodable {
  let platform: String
  let productId: String
  let transactionId: String
  let originalTransactionId: String
  let signedTransactionInfo: String
}

private struct UnfinishedTransactionsPayload: Encodable {
  let transactions: [BillingTransactionPayload]
}

private struct FinishTransactionPayload: Encodable {
  let finished: Bool
}

private enum BillingDiagnosticEvent: String {
  case subscribeEntry = "subscribe.entry"
  case argumentsValidated = "arguments.validated"
  case argumentsRejected = "arguments.rejected"
  case productsQueryStarted = "products.query.started"
  case productUnavailable = "products.unavailable"
  case presenterUnavailable = "presenter.unavailable"
  case purchaseStarted = "purchase.started"
}

private enum BillingDiagnosticFailureStage: String {
  case arguments
  case products
  case presentation
  case purchase
}

private enum BillingDiagnosticPresentationStage: String {
  case beforePurchase = "purchase.before"
  case awaitingOneSecond = "purchase.awaiting-1s"
  case awaitingThreeSeconds = "purchase.awaiting-3s"
}

private enum BillingDiagnosticPresenter: String {
  case viewController = "view-controller"
  case scene
  case legacy
}

private enum BillingDiagnosticResult: String {
  case success
  case userCancelled = "user-cancelled"
  case pending
  case unknown
}

private enum BillingDiagnostics {
  private static let prefix = "[billing-debug]"

  static func event(_ attemptId: String, _ event: BillingDiagnosticEvent) {
    output(attemptId, event.rawValue)
  }

  static func productsLoaded(_ attemptId: String, count: Int) {
    output(attemptId, "products.query.completed count=\(count)")
  }

  static func presenter(_ attemptId: String, _ presenter: BillingDiagnosticPresenter) {
    output(attemptId, "presenter.selected kind=\(presenter.rawValue)")
  }

  static func result(_ attemptId: String, _ result: BillingDiagnosticResult) {
    output(attemptId, "purchase.result category=\(result.rawValue)")
  }

  static func failure(
    _ attemptId: String,
    stage: BillingDiagnosticFailureStage,
    error: Error
  ) {
    let nsError = error as NSError
    output(
      attemptId,
      "failure stage=\(stage.rawValue) type=\(String(reflecting: type(of: error))) domain=\(nsError.domain) code=\(nsError.code)"
    )
  }

  static func presentation(
    _ attemptId: String,
    stage: BillingDiagnosticPresentationStage,
    appState: String,
    managerController: String,
    managerViewLoaded: Bool,
    managerWindowAttached: Bool,
    presentedController: String,
    sceneState: String,
    windowCount: Int,
    windows: String
  ) {
    output(
      attemptId,
      "\(stage.rawValue) app=\(appState) manager=\(managerController) viewLoaded=\(managerViewLoaded) windowAttached=\(managerWindowAttached) presented=\(presentedController) scene=\(sceneState) windowCount=\(windowCount) windows=[\(windows)]"
    )
  }

  private static func output(_ attemptId: String, _ message: String) {
    let line = "\(prefix)[\(attemptId)] \(message)"
    NSLog("%@", line)
    guard let data = "\(line)\n".data(using: .utf8) else { return }
    FileHandle.standardError.write(data)
    appendToDiagnosticFile(data)
  }

  private static func appendToDiagnosticFile(_ data: Data) {
    guard
      let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    else { return }
    let url = documents.appendingPathComponent("billing-diagnostics.log")
    if !FileManager.default.fileExists(atPath: url.path) {
      try? data.write(to: url, options: .atomic)
      return
    }
    guard let file = try? FileHandle(forWritingTo: url) else { return }
    defer { try? file.close() }
    do {
      try file.seekToEnd()
      try file.write(contentsOf: data)
    } catch {
      return
    }
  }
}

private final class BillingPlugin: Plugin {
  private let productId = "pro_monthly"

  @objc public func subscribe(_ invoke: Invoke) throws {
    Task { @MainActor in
      let attemptId = String(UUID().uuidString.prefix(8))
      var failureStage = BillingDiagnosticFailureStage.arguments
      BillingDiagnostics.event(attemptId, .subscribeEntry)
      do {
        let args = try invoke.getArgs()
        guard
          let tokenString = args.getString("appAccountToken"),
          let appAccountToken = UUID(uuidString: tokenString)
        else {
          BillingDiagnostics.event(attemptId, .argumentsRejected)
          invoke.reject("購入アカウント情報がありません")
          return
        }
        BillingDiagnostics.event(attemptId, .argumentsValidated)
        failureStage = .products
        BillingDiagnostics.event(attemptId, .productsQueryStarted)
        let products = try await Product.products(for: [productId])
        BillingDiagnostics.productsLoaded(attemptId, count: products.count)
        guard let product = products.first else {
          BillingDiagnostics.event(attemptId, .productUnavailable)
          invoke.reject("商品が見つかりません")
          return
        }

        let purchaseOptions: Set<Product.PurchaseOption> = [
          .appAccountToken(appAccountToken)
        ]
        failureStage = .presentation
        logPresentationState(attemptId: attemptId, stage: .beforePurchase)
        let presentationProbe = makePresentationProbe(attemptId: attemptId)
        defer { presentationProbe.cancel() }

        let result: Product.PurchaseResult
        if #available(iOS 18.2, *) {
          guard let viewController = foregroundViewController() else {
            BillingDiagnostics.event(attemptId, .presenterUnavailable)
            invoke.reject("購入画面を表示できません")
            return
          }
          BillingDiagnostics.presenter(attemptId, .viewController)
          BillingDiagnostics.event(attemptId, .purchaseStarted)
          failureStage = .purchase
          result = try await product.purchase(
            confirmIn: viewController,
            options: purchaseOptions)
        } else if #available(iOS 17.0, *) {
          guard let scene = foregroundScene() else {
            BillingDiagnostics.event(attemptId, .presenterUnavailable)
            invoke.reject("購入画面を表示できません")
            return
          }
          BillingDiagnostics.presenter(attemptId, .scene)
          BillingDiagnostics.event(attemptId, .purchaseStarted)
          failureStage = .purchase
          result = try await product.purchase(
            confirmIn: scene,
            options: purchaseOptions)
        } else {
          BillingDiagnostics.presenter(attemptId, .legacy)
          BillingDiagnostics.event(attemptId, .purchaseStarted)
          failureStage = .purchase
          result = try await product.purchase(options: purchaseOptions)
        }
        presentationProbe.cancel()
        switch result {
        case .success(let verification):
          BillingDiagnostics.result(attemptId, .success)
          let transaction = try checkVerified(verification)
          invoke.resolve(
            payload(
              for: transaction,
              signedTransactionInfo: verification.jwsRepresentation))
        case .userCancelled:
          BillingDiagnostics.result(attemptId, .userCancelled)
          invoke.reject("購入をキャンセルしました")
        case .pending:
          BillingDiagnostics.result(attemptId, .pending)
          invoke.reject("購入は保留中です")
        @unknown default:
          BillingDiagnostics.result(attemptId, .unknown)
          invoke.reject("購入に失敗しました")
        }
      } catch {
        BillingDiagnostics.failure(attemptId, stage: failureStage, error: error)
        invoke.reject("購入に失敗しました: \(error.localizedDescription)")
      }
    }
  }

  @objc public func restore(_ invoke: Invoke) throws {
    Task { @MainActor in
      do {
        try await AppStore.sync()
        for await entitlement in Transaction.currentEntitlements {
          let transaction = try checkVerified(entitlement)
          guard transaction.productID == productId else { continue }
          invoke.resolve(
            payload(
              for: transaction,
              signedTransactionInfo: entitlement.jwsRepresentation))
          return
        }
        invoke.reject("復元できる購入が見つかりません")
      } catch {
        invoke.reject("購入の復元に失敗しました: \(error.localizedDescription)")
      }
    }
  }

  @objc public func unfinished(_ invoke: Invoke) throws {
    Task {
      var transactions: [BillingTransactionPayload] = []
      for await verification in Transaction.unfinished {
        do {
          let transaction = try checkVerified(verification)
          guard transaction.productID == productId else { continue }
          transactions.append(
            payload(
              for: transaction,
              signedTransactionInfo: verification.jwsRepresentation))
        } catch {
          continue
        }
      }
      invoke.resolve(UnfinishedTransactionsPayload(transactions: transactions))
    }
  }

  @objc public func finish(_ invoke: Invoke) throws {
    Task {
      do {
        let args = try invoke.getArgs()
        guard
          let transactionId = args.getString("transactionId"),
          let requestedId = UInt64(transactionId)
        else {
          invoke.reject("取引IDがありません")
          return
        }
        for await verification in Transaction.unfinished {
          let transaction: Transaction
          do {
            transaction = try checkVerified(verification)
          } catch {
            continue
          }
          guard transaction.id == requestedId else { continue }
          await transaction.finish()
          invoke.resolve(FinishTransactionPayload(finished: true))
          return
        }
        // 既に完了済みの場合も冪等な成功として扱う。
        invoke.resolve(FinishTransactionPayload(finished: false))
      } catch {
        invoke.reject("取引を完了できませんでした: \(error.localizedDescription)")
      }
    }
  }

  private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
    switch result {
    case .unverified:
      throw BillingError.unverified
    case .verified(let value):
      return value
    }
  }

  @MainActor
  private func foregroundViewController() -> UIViewController? {
    guard let viewController = manager.viewController,
      let scene = viewController.viewIfLoaded?.window?.windowScene,
      scene.activationState == .foregroundActive
    else {
      return nil
    }
    return viewController
  }

  @MainActor
  private func foregroundScene() -> UIWindowScene? {
    if let scene = manager.viewController?.viewIfLoaded?.window?.windowScene,
      scene.activationState == .foregroundActive
    {
      return scene
    }
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
  }

  @MainActor
  private func makePresentationProbe(attemptId: String) -> Task<Void, Never> {
    Task { @MainActor [weak self] in
      do {
        try await Task.sleep(nanoseconds: 1_000_000_000)
      } catch {
        return
      }
      guard !Task.isCancelled else { return }
      self?.logPresentationState(attemptId: attemptId, stage: .awaitingOneSecond)

      do {
        try await Task.sleep(nanoseconds: 2_000_000_000)
      } catch {
        return
      }
      guard !Task.isCancelled else { return }
      self?.logPresentationState(attemptId: attemptId, stage: .awaitingThreeSeconds)
    }
  }

  @MainActor
  private func logPresentationState(
    attemptId: String,
    stage: BillingDiagnosticPresentationStage
  ) {
    let viewController = manager.viewController
    let managerWindow = viewController?.viewIfLoaded?.window
    let scene = managerWindow?.windowScene ?? foregroundScene()
    let windows = scene?.windows ?? []
    let windowSummary = windows.enumerated().map { index, window in
      let rootController = controllerClassName(window.rootViewController)
      return
        "w\(index){key=\(window.isKeyWindow),hidden=\(window.isHidden),alpha=\(String(format: "%.2f", Double(window.alpha))),level=\(window.windowLevel.rawValue),bounds=\(NSCoder.string(for: window.bounds)),root=\(rootController)}"
    }.joined(separator: ";")

    BillingDiagnostics.presentation(
      attemptId,
      stage: stage,
      appState: applicationStateName(UIApplication.shared.applicationState),
      managerController: controllerClassName(viewController),
      managerViewLoaded: viewController?.isViewLoaded ?? false,
      managerWindowAttached: managerWindow != nil,
      presentedController: controllerClassName(viewController?.presentedViewController),
      sceneState: sceneStateName(scene?.activationState),
      windowCount: windows.count,
      windows: windowSummary)
  }

  private func controllerClassName(_ viewController: UIViewController?) -> String {
    guard let viewController else { return "none" }
    return String(reflecting: type(of: viewController))
  }

  private func applicationStateName(_ state: UIApplication.State) -> String {
    switch state {
    case .active:
      return "active"
    case .inactive:
      return "inactive"
    case .background:
      return "background"
    @unknown default:
      return "unknown"
    }
  }

  private func sceneStateName(_ state: UIScene.ActivationState?) -> String {
    switch state {
    case .foregroundActive:
      return "foreground-active"
    case .foregroundInactive:
      return "foreground-inactive"
    case .background:
      return "background"
    case .unattached:
      return "unattached"
    case nil:
      return "none"
    @unknown default:
      return "unknown"
    }
  }

  private func payload(
    for transaction: Transaction,
    signedTransactionInfo: String
  ) -> BillingTransactionPayload {
    BillingTransactionPayload(
      platform: "apple",
      productId: transaction.productID,
      transactionId: String(transaction.id),
      originalTransactionId: String(transaction.originalID),
      signedTransactionInfo: signedTransactionInfo)
  }
}

@_cdecl("init_plugin_nativebilling")
func initPluginNativeBilling() -> Plugin {
  BillingPlugin()
}
