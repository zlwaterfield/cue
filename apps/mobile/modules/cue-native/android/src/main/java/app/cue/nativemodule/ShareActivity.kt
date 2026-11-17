package app.cue.nativemodule

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast

/**
 * A link or text shared to Cue from another app. As on iOS, a link is added on its own
 * (a page's title, which some apps send along with it, is left out), and text keeps its
 * lines. It's left in the inbox for the app, with a short "Added to Today".
 */
class ShareActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val text = if (savedInstanceState == null) sharedText(intent) else null
    if (text.isNullOrEmpty()) {
      Toast.makeText(this, "Nothing to add. Cue can add links and text.", Toast.LENGTH_SHORT).show()
    } else {
      try {
        Inbox.add(applicationContext, text)
        Toast.makeText(this, "Added to Today", Toast.LENGTH_SHORT).show()
      } catch (error: Exception) {
        Toast.makeText(this, "Couldn’t add this to Cue", Toast.LENGTH_SHORT).show()
      }
    }
    finish()
  }

  private fun sharedText(intent: Intent?): String? {
    if (intent?.action != Intent.ACTION_SEND) return null
    val shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim() ?: return null
    return firstWebLink(shared) ?: shared
  }

  /**
   * Many apps share a link as "Some title https://…": when the text is one http(s) link with
   * at most a line or two of words around it, the link is what's kept, as iOS keeps the URL.
   */
  private fun firstWebLink(text: String): String? {
    val words = text.split(Regex("\\s+"))
    val links = words.filter { word ->
      val uri = runCatching { Uri.parse(word) }.getOrNull()
      (uri?.scheme == "http" || uri?.scheme == "https") && !uri.host.isNullOrEmpty()
    }
    if (links.size != 1) return null
    if (links[0] == text) return text
    return if (text.lines().size <= 3) links[0] else null
  }
}
