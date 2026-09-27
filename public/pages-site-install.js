const button = document.querySelector('[data-copy-install]');
const command = document.querySelector('#install-command');
const status = document.querySelector('[data-copy-status]');
if (button && command && status) {
  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command.textContent);
      status.textContent = 'Команда скопирована';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(command);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Скопируйте выделенную команду';
    }
  });
}
