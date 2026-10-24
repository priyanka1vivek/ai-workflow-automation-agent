const form = document.querySelector('#intake-form');
const result = document.querySelector('#result');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Sending…';
  result.hidden = true;
  try {
    const fields = new FormData(form);
    const response = await fetch('/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: fields.get('title'), message: fields.get('message') })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The request could not be sent.');
    result.classList.remove('error');
    result.textContent = `Request ${data.id} received. Its status is ${data.status}. A workspace reviewer will check it before delivery.`;
    form.reset();
  } catch (error) {
    result.classList.add('error');
    result.textContent = error.message;
  } finally {
    result.hidden = false;
    button.disabled = false;
    button.textContent = 'Send request →';
  }
});
