package app.cue.nativemodule

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * What was shared to Cue, waiting to be added to today: one small JSON file per share,
 * `{ text, at }`, named so that sorting the names puts the oldest first. The same format
 * as the iOS share extension's app-group inbox.
 */
internal object Inbox {
  fun dir(context: Context): File = File(context.filesDir, "Inbox")

  fun add(context: Context, text: String) {
    val inbox = dir(context).apply { mkdirs() }
    val now = System.currentTimeMillis()
    val name = "$now-${UUID.randomUUID()}.json"
    val entry = JSONObject().put("text", text).put("at", now)
    // Written whole, then renamed, so the app never reads half a share.
    val partial = File(inbox, "$name.part")
    partial.writeText(entry.toString())
    if (!partial.renameTo(File(inbox, name))) {
      partial.delete()
      throw IllegalStateException("Couldn't store the share")
    }
  }

  fun entries(context: Context): List<Map<String, Any>> {
    val names = dir(context).list() ?: return emptyList()
    return names.filter { it.endsWith(".json") }.sorted().mapNotNull { name ->
      runCatching {
        val entry = JSONObject(File(dir(context), name).readText())
        val text = entry.optString("text", "")
        if (text.isEmpty()) null else mapOf("name" to name, "text" to text, "at" to entry.optLong("at"))
      }.getOrNull()
    }
  }

  fun remove(context: Context, names: List<String>) {
    for (name in names) {
      if (!name.contains('/')) File(dir(context), name).delete()
    }
  }
}
