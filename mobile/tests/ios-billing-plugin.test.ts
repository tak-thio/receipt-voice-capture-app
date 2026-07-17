// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const billingPlugin = readFileSync(
  resolve(process.cwd(), 'src-tauri/ios/Sources/BillingPlugin.swift'),
  'utf8',
)

describe('iOS StoreKit purchase presentation', () => {
  it('presents from the foreground UIKit host while preserving fallbacks and the account token', () => {
    expect(billingPlugin).toContain('import UIKit')
    expect(billingPlugin).toMatch(
      /let purchaseOptions: Set<Product\.PurchaseOption> = \[\s*\.appAccountToken\(appAccountToken\),?\s*\][\s\S]*?if #available\(iOS 18\.2, \*\) \{[\s\S]*?guard let viewController = foregroundViewController\(\) else \{[\s\S]*?invoke\.reject\("購入画面を表示できません"\)[\s\S]*?return[\s\S]*?\}[\s\S]*?result = try await product\.purchase\(\s*confirmIn: viewController,\s*options: purchaseOptions\s*\)[\s\S]*?\} else if #available\(iOS 17\.0, \*\) \{[\s\S]*?guard let scene = foregroundScene\(\) else \{[\s\S]*?invoke\.reject\("購入画面を表示できません"\)[\s\S]*?return[\s\S]*?\}[\s\S]*?result = try await product\.purchase\(\s*confirmIn: scene,\s*options: purchaseOptions\s*\)[\s\S]*?\} else \{[\s\S]*?result = try await product\.purchase\(\s*options: purchaseOptions\s*\)[\s\S]*?\}/,
    )
    expect(billingPlugin).toMatch(
      /private func foregroundViewController\(\) -> UIViewController\? \{\s*guard let viewController = manager\.viewController,\s*let scene = viewController\.viewIfLoaded\?\.window\?\.windowScene,\s*scene\.activationState == \.foregroundActive\s*else \{\s*return nil\s*\}\s*return viewController\s*\}/,
    )
    expect(billingPlugin).toMatch(
      /private func foregroundScene\(\) -> UIWindowScene\? \{\s*if let scene = manager\.viewController\?\.viewIfLoaded\?\.window\?\.windowScene,\s*scene\.activationState == \.foregroundActive\s*\{\s*return scene\s*\}\s*return UIApplication\.shared\.connectedScenes\s*\.compactMap \{ \$0 as\? UIWindowScene \}\s*\.first \{ \$0\.activationState == \.foregroundActive \}\s*\}/,
    )
  })

  it('keeps verified purchases unfinished until server verification succeeds', () => {
    const subscribeBody = billingPlugin.match(
      /@objc public func subscribe\(_ invoke: Invoke\) throws \{([\s\S]*?)\n\s*@objc public func restore/,
    )?.[1]

    expect(subscribeBody).toBeTruthy()
    expect(subscribeBody).toContain('case .success(let verification):')
    expect(subscribeBody).not.toContain('transaction.finish()')
    expect(billingPlugin).toContain('@objc public func unfinished(_ invoke: Invoke) throws')
    expect(billingPlugin).toContain('Transaction.unfinished')
    expect(billingPlugin).toContain('@objc public func finish(_ invoke: Invoke) throws')
  })

  it('avoids cross-thread plugin listeners and relies on unfinished polling', () => {
    expect(billingPlugin).not.toContain('Transaction.updates')
    expect(billingPlugin).not.toContain('trigger("transaction-updated"')
  })

  it('emits safe cancellable diagnostics while StoreKit is awaiting presentation', () => {
    expect(billingPlugin).toMatch(
      /let attemptId = String\(UUID\(\)\.uuidString\.prefix\(8\)\)/,
    )
    expect(billingPlugin).toContain('case subscribeEntry = "subscribe.entry"')
    expect(billingPlugin).toContain('case productsQueryStarted = "products.query.started"')
    expect(billingPlugin).toContain('case purchaseStarted = "purchase.started"')
    expect(billingPlugin).toContain('case awaitingOneSecond = "purchase.awaiting-1s"')
    expect(billingPlugin).toContain('case awaitingThreeSeconds = "purchase.awaiting-3s"')
    const subscribeBody = billingPlugin.match(
      /@objc public func subscribe\(_ invoke: Invoke\) throws \{([\s\S]*?)\n\s*@objc public func restore/,
    )?.[1]
    expect(subscribeBody).toBeTruthy()
    expect(subscribeBody).toMatch(
      /\.subscribeEntry[\s\S]*?let args = try invoke\.getArgs\(\)[\s\S]*?\.argumentsValidated[\s\S]*?\.productsQueryStarted[\s\S]*?Product\.products[\s\S]*?productsLoaded[\s\S]*?let purchaseOptions/,
    )
    expect(
      subscribeBody?.match(/makePresentationProbe\(attemptId: attemptId\)/g),
    ).toHaveLength(1)
    expect(subscribeBody).toMatch(
      /let presentationProbe = makePresentationProbe\(attemptId: attemptId\)\s*defer \{ presentationProbe\.cancel\(\) \}[\s\S]*?let result: Product\.PurchaseResult[\s\S]*?presentationProbe\.cancel\(\)\s*switch result/,
    )
    expect(subscribeBody).toMatch(
      /\.viewController[\s\S]*?\.purchaseStarted[\s\S]*?product\.purchase\(\s*confirmIn: viewController/,
    )
    expect(subscribeBody).toMatch(
      /\.scene[\s\S]*?\.purchaseStarted[\s\S]*?product\.purchase\(\s*confirmIn: scene/,
    )
    expect(subscribeBody).toMatch(
      /\.legacy[\s\S]*?\.purchaseStarted[\s\S]*?product\.purchase\(options: purchaseOptions\)/,
    )

    const diagnostics = billingPlugin.match(
      /private enum BillingDiagnostics \{([\s\S]*?)\n\}\n\nprivate final class BillingPlugin/,
    )?.[1]
    expect(diagnostics).toBeTruthy()
    expect(diagnostics).toMatch(
      /static func failure\([\s\S]*?let nsError = error as NSError[\s\S]*?String\(reflecting: type\(of: error\)\)[\s\S]*?nsError\.domain[\s\S]*?nsError\.code/,
    )
    expect(diagnostics).toMatch(
      /FileHandle\.standardError\.write\(data\)/,
    )
    expect(diagnostics).not.toMatch(
      /tokenString|appAccountToken|transaction|verification|signedTransactionInfo|localizedDescription|serverUrl|deviceToken|email/,
    )

    const probe = billingPlugin.match(
      /@MainActor\s*private func makePresentationProbe\(attemptId: String\) -> Task<Void, Never> \{\s*Task \{ @MainActor \[weak self\] in([\s\S]*?)\n\s*\}\n\s*\}/,
    )?.[1]
    expect(probe).toBeTruthy()
    expect(probe).toMatch(
      /Task\.sleep\(nanoseconds: 1_000_000_000\)[\s\S]*?guard !Task\.isCancelled else \{ return \}[\s\S]*?\.awaitingOneSecond[\s\S]*?Task\.sleep\(nanoseconds: 2_000_000_000\)[\s\S]*?guard !Task\.isCancelled else \{ return \}[\s\S]*?\.awaitingThreeSeconds/,
    )
    expect(probe).not.toMatch(/\binvoke\b|\bfinish\b|\btransaction\b/)

    const snapshot = billingPlugin.match(
      /private func logPresentationState\([\s\S]*?\) \{([\s\S]*?)\n\s*\}\n\n\s*private func controllerClassName/,
    )?.[1]
    expect(snapshot).toBeTruthy()
    expect(snapshot).toMatch(
      /controllerClassName[\s\S]*?isKeyWindow[\s\S]*?isHidden[\s\S]*?windowLevel[\s\S]*?bounds[\s\S]*?windows\.count/,
    )
    expect(snapshot).not.toMatch(
      /tokenString|appAccountToken|transaction|verification|signedTransactionInfo|localizedDescription|serverUrl|deviceToken|email/,
    )
  })
})

describe('iOS StoreKit release configuration', () => {
  it('keeps the generated Xcode version aligned with the committed Info.plist', () => {
    const project = readFileSync(
      resolve(process.cwd(), 'src-tauri/gen/apple/project.yml'),
      'utf8',
    )
    const infoPlist = readFileSync(
      resolve(process.cwd(), 'src-tauri/gen/apple/receipt_voice_capture_iOS/Info.plist'),
      'utf8',
    )

    expect(project).toContain('CFBundleShortVersionString: 1.0.2')
    expect(project).toContain('CFBundleVersion: "1.0.2"')
    expect(project).toContain('storeKitConfiguration: LocalBilling.storekit')
    expect(project).toMatch(/fileGroups:.*LocalBilling\.storekit/)
    expect(infoPlist).toMatch(
      /<key>CFBundleShortVersionString<\/key>\s*<string>1\.0\.2<\/string>/,
    )
  })

  it('ships the StoreKit configuration referenced by the shared scheme', () => {
    const storeKitPath = resolve(process.cwd(), 'src-tauri/gen/apple/LocalBilling.storekit')
    const scheme = readFileSync(
      resolve(
        process.cwd(),
        'src-tauri/gen/apple/receipt_voice_capture.xcodeproj/xcshareddata/xcschemes/receipt_voice_capture_iOS.xcscheme',
      ),
      'utf8',
    )

    expect(existsSync(storeKitPath)).toBe(true)
    expect(scheme).toContain('../../LocalBilling.storekit')
    const storeKit = JSON.parse(readFileSync(storeKitPath, 'utf8')) as {
      subscriptionGroups: Array<{ subscriptions: Array<{ productID: string }> }>
    }
    expect(storeKit.subscriptionGroups[0]?.subscriptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ productID: 'pro_monthly' })]),
    )
  })
})
