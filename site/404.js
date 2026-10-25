// An empty page, like an empty day: type and it's yours, until you leave.
(() => {
  const now = new Date()
  document.querySelector('.date').textContent =
    now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const line = document.querySelector('.line'), typed = document.querySelector('.typed')
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || cue.paletteOpen) return
    if (e.key === 'Backspace') typed.textContent = typed.textContent.slice(0, -1)
    else if (e.key.length === 1 && typed.textContent.length < 80) typed.textContent += e.key
    else return
    e.preventDefault()
    line.classList.toggle('empty', !typed.textContent)
  })
})()
