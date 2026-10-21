package expo.modules.applist

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Bundle
import android.util.Base64
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream

private const val ICON_PX = 96

private class AppNotFoundException(pkg: String) :
  CodedException("ERR_APP_NOT_FOUND", "No launchable activity for $pkg", null)

/**
 * The launcher's app list: every MAIN+LAUNCHER activity on the unit, with its label and
 * a ≤96 px PNG icon as a data URI, plus a launch call. Mirrors what a stock launcher's
 * drawer shows. Needs the MAIN/LAUNCHER <queries> entry (plugins/withLauncherQueries.js)
 * or Android 11+ package visibility hides every other app.
 *
 * One entry per launcher ACTIVITY, not per package, and launch() takes the explicit
 * component — so apps with several launcher activities (ZLink: CarPlay / HiCar / …)
 * open the one the user tapped instead of the system chooser.
 */
class AppListModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "No React context" }

  // "pkg/activity@lastUpdateTime" -> data URI. Icon render + PNG encode is the
  // expensive part; keying on lastUpdateTime refreshes an icon when its app updates.
  private val iconCache = HashMap<String, String>()

  override fun definition() = ModuleDefinition {
    Name("AppList")

    AsyncFunction("listApps") { listApps() }

    Function("launch") { pkg: String, activity: String? -> launch(pkg, activity) }
  }

  @Synchronized
  private fun listApps(): List<Bundle> {
    val pm = context.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    @Suppress("DEPRECATION")
    val infos: List<ResolveInfo> = pm.queryIntentActivities(intent, 0)
    val seen = HashSet<String>()
    val out = ArrayList<Bundle>()
    for (ri in infos) {
      val ai = ri.activityInfo ?: continue
      if (ai.packageName == context.packageName) continue // never list ourselves
      val key = "${ai.packageName}/${ai.name}@${lastUpdate(pm, ai.packageName)}"
      seen.add(key)
      val icon = iconCache[key] ?: renderIcon(ri, pm)?.also { iconCache[key] = it }
      out.add(
        bundleOf(
          "package" to ai.packageName,
          "activity" to ai.name,
          "label" to ri.loadLabel(pm).toString(),
          "iconDataUri" to icon
        )
      )
    }
    iconCache.keys.retainAll(seen) // drop uninstalled / updated entries
    return out.sortedBy { (it.getString("label") ?: "").lowercase() }
  }

  private fun lastUpdate(pm: PackageManager, pkg: String): Long =
    try {
      @Suppress("DEPRECATION")
      pm.getPackageInfo(pkg, 0).lastUpdateTime
    } catch (_: Throwable) {
      0L
    }

  private fun renderIcon(ri: ResolveInfo, pm: PackageManager): String? =
    try {
      val d = ri.loadIcon(pm).mutate()
      val bmp = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888)
      d.setBounds(0, 0, ICON_PX, ICON_PX)
      d.draw(Canvas(bmp))
      val buf = ByteArrayOutputStream()
      bmp.compress(Bitmap.CompressFormat.PNG, 100, buf)
      bmp.recycle()
      "data:image/png;base64," + Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP)
    } catch (_: Throwable) {
      null // JS renders a monogram tile instead
    }

  private fun launch(pkg: String, activity: String?) {
    val intent =
      if (!activity.isNullOrEmpty()) {
        Intent(Intent.ACTION_MAIN)
          .addCategory(Intent.CATEGORY_LAUNCHER)
          .setComponent(ComponentName(pkg, activity))
      } else {
        context.packageManager.getLaunchIntentForPackage(pkg) ?: throw AppNotFoundException(pkg)
      }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    try {
      val activityCtx = appContext.activityProvider?.currentActivity
      (activityCtx ?: context).startActivity(intent)
    } catch (_: Throwable) {
      throw AppNotFoundException(pkg)
    }
  }
}
