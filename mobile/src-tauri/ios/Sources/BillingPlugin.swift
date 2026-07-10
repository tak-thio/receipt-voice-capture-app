import Foundation
import StoreKit
import SwiftRs
import Tauri

private enum BillingError: LocalizedError {
  case unverified

  var errorDescription: String? {
    switch self {
    case .unverified:
      return "購入情報を検証できませんでした"
    }
  }
}

private final class BillingPlugin: Plugin {
  private let productId = "pro_monthly"

  @objc public func subscribe(_ invoke: Invoke) throws {
    Task { @MainActor in
      do {
        let products = try await Product.products(for: [productId])
        guard let product = products.first else {
          invoke.reject("商品が見つかりません")
          return
        }

        let result = try await product.purchase()
        switch result {
        case .success(let verification):
          let transaction = try checkVerified(verification)
          await transaction.finish()
          invoke.resolve(
            payload(
              for: transaction,
              signedTransactionInfo: verification.jwsRepresentation))
        case .userCancelled:
          invoke.reject("購入をキャンセルしました")
        case .pending:
          invoke.reject("購入は保留中です")
        @unknown default:
          invoke.reject("購入に失敗しました")
        }
      } catch {
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

  private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
    switch result {
    case .unverified:
      throw BillingError.unverified
    case .verified(let value):
      return value
    }
  }

  private func payload(for transaction: Transaction, signedTransactionInfo: String) -> JsonObject {
    [
      "platform": "apple",
      "productId": transaction.productID,
      "transactionId": String(transaction.id),
      "originalTransactionId": String(transaction.originalID),
      "signedTransactionInfo": signedTransactionInfo,
    ]
  }
}

@_cdecl("init_plugin_nativebilling")
func initPluginNativeBilling() -> Plugin {
  BillingPlugin()
}
