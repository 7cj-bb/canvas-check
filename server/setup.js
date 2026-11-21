const form = document.querySelector('#setup'), status = document.querySelector('#status'), key = document.querySelector('#key'), button = document.querySelector('#save'), model = document.querySelector('#model');
async function health() { try { const data = await (await fetch('/health')).json(); model.value = data.model; status.textContent = data.configured ? '本机已保存密钥。可返回 Canvas 查看自动分析；这不代表密钥已通过在线验证。' : '本机服务已就绪，等待填写密钥。'; } catch { status.textContent = '本机服务暂未连接。'; } }
form.addEventListener('submit', async event => {
  event.preventDefault(); button.disabled = true; status.className = ''; status.textContent = '正在保存到本机…';
  try {
    const response = await fetch('/configure', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf"]').content }, body: JSON.stringify({ apiKey: key.value, model: model.value }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '保存未完成');
    key.value = ''; form.reset(); model.value = (await (await fetch('/health')).json()).model; status.className = 'saved'; status.textContent = '已保存到本机。返回 Canvas，扩展会自动连接。密钥有效性将在首次实际请求时验证。';
  } catch (error) { status.className = 'error'; status.textContent = error.message || '连接未完成，请重试。'; }
  finally { button.disabled = false; }
});
health();
