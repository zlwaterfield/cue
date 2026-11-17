package app.cue.nativemodule

import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import com.facebook.react.uimanager.RootView
import com.facebook.react.views.textinput.ReactEditText
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The Android side of the iOS module (CueNativeModule.swift):
 *
 * - Put the caret exactly where a line was tapped. Lines that aren't being edited don't take
 *   touches (so a long press can pick them up), so the tap is forwarded here.
 * - Background time: Android doesn't suspend an app the moment it leaves the screen the way
 *   iOS does, so the last upload simply finishes; these are no-ops.
 * - The share inbox, filled by ShareActivity.
 */
class CueNativeModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext).applicationContext

  override fun definition() = ModuleDefinition {
    Name("CueNative")

    /** Focuses the text input inside `view` with the caret nearest to a point in window dp. */
    AsyncFunction("focusAt") { view: View, x: Double, y: Double ->
      val input = findTextInput(view) ?: return@AsyncFunction -1
      val density = input.resources.displayMetrics.density
      // RNGH's absolute coordinates are relative to the React root view.
      val root = IntArray(2)
      generateSequence(input.parent) { it.parent }.filterIsInstance<RootView>().firstOrNull()
        ?.let { (it as? View)?.getLocationInWindow(root) }
      val at = IntArray(2)
      input.getLocationInWindow(at)
      val offset = input.getOffsetForPosition(
        (x * density + root[0] - at[0]).toFloat(),
        (y * density + root[1] - at[1]).toFloat()
      ).let { if (it < 0) input.text.length else it.coerceIn(0, input.text.length) }
      if (!input.hasFocus()) {
        if (input is ReactEditText) input.requestFocusFromJS() else input.requestFocus()
      }
      input.setSelection(offset)
      offset
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("beginBackgroundTask") { -> 0 }
    AsyncFunction("endBackgroundTask") { _: Int -> }

    /** What's waiting in the share inbox, oldest first: `{ name, text, at }` each. */
    Function("sharedInbox") { Inbox.entries(context) }

    /** Take shares out of the inbox once they're in the notes. */
    Function("removeShared") { names: List<String> -> Inbox.remove(context, names) }
  }
}

private fun findTextInput(view: View): EditText? {
  if (view is EditText) return view
  if (view is ViewGroup) {
    for (i in 0 until view.childCount) findTextInput(view.getChildAt(i))?.let { return it }
  }
  return null
}
