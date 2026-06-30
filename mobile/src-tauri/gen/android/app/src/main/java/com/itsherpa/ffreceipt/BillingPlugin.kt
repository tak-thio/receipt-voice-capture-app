package com.itsherpa.ffreceipt

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams

// アプリ内課金(IAP / ⑤): サブスク(pro_monthly)を購入し purchaseToken を返す。
// サーバが /billing/google/verify でトークンを検証して pro を付与する。
@TauriPlugin
class BillingPlugin(private val activity: Activity) : Plugin(activity) {
    private val productId = "pro_monthly"
    private var client: BillingClient? = null
    private var pending: Invoke? = null

    private val listener = PurchasesUpdatedListener { result, purchases ->
        val inv = pending
        pending = null
        when {
            result.responseCode == BillingClient.BillingResponseCode.OK && !purchases.isNullOrEmpty() -> {
                val p = purchases[0]
                if (!p.isAcknowledged) {
                    val ack = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()
                    client?.acknowledgePurchase(ack) { }
                }
                val ret = JSObject()
                ret.put("purchaseToken", p.purchaseToken)
                ret.put("productId", p.products.firstOrNull() ?: productId)
                inv?.resolve(ret)
            }
            result.responseCode == BillingClient.BillingResponseCode.USER_CANCELED ->
                inv?.reject("購入をキャンセルしました")
            else ->
                inv?.reject("購入に失敗しました (${result.responseCode})")
        }
    }

    @Command
    fun subscribe(invoke: Invoke) {
        pending = invoke
        val c = BillingClient.newBuilder(activity)
            .setListener(listener)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
        client = c
        c.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    pending = null
                    invoke.reject("課金サービスに接続できません (${result.responseCode})")
                    return
                }
                queryAndLaunch(c, invoke)
            }

            override fun onBillingServiceDisconnected() {}
        })
    }

    private fun queryAndLaunch(c: BillingClient, invoke: Invoke) {
        val params = QueryProductDetailsParams.newBuilder().setProductList(
            listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            )
        ).build()
        c.queryProductDetailsAsync(params) { result, list ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK || list.isEmpty()) {
                pending = null
                invoke.reject("商品が見つかりません (${result.responseCode})")
                return@queryProductDetailsAsync
            }
            val pd = list[0]
            val offerToken = pd.subscriptionOfferDetails?.firstOrNull()?.offerToken
            if (offerToken == null) {
                pending = null
                invoke.reject("購入プランが見つかりません")
                return@queryProductDetailsAsync
            }
            val flow = BillingFlowParams.newBuilder().setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(pd)
                        .setOfferToken(offerToken)
                        .build()
                )
            ).build()
            activity.runOnUiThread { c.launchBillingFlow(activity, flow) }
        }
    }
}
