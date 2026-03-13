/**
 * gate.js — Makoy resource gate
 * Include this script in any /resources/ page.
 * - Same device (localStorage flag) → no gate, page shows immediately.
 * - First visit → full-page gate overlay, email capture via magic link.
 * - After magic link click → ?unlocked=1 → sets flag, cleans URL, page shows.
 */
(function () {
  const API    = 'https://api.makoy.org';
  const LS_KEY = 'makoy_unlocked';

  // ── Same device: already verified ──
  if (localStorage.getItem(LS_KEY) === '1') return;

  // ── Returning from magic link ──
  const params = new URLSearchParams(window.location.search);
  if (params.get('unlocked') === '1') {
    localStorage.setItem(LS_KEY, '1');
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    return;
  }

  // ── Not verified — inject gate overlay ──
  const errorOnLoad = params.get('unlocked') === 'error';
  if (errorOnLoad) {
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }

  // Hide page content until verified
  const hideStyle = document.createElement('style');
  hideStyle.id = 'makoy-gate-hide';
  hideStyle.textContent = 'body > *:not(#makoy-gate-overlay) { visibility: hidden; }';
  document.head.appendChild(hideStyle);

  function injectGate() {
    const overlay = document.createElement('div');
    overlay.id = 'makoy-gate-overlay';
    overlay.innerHTML = `
      <div style="
        position:fixed;inset:0;z-index:99999;
        background:rgba(61,43,31,0.55);backdrop-filter:blur(6px);
        display:flex;align-items:center;justify-content:center;
        padding:1.5rem;font-family:Georgia,serif;
      ">
        <div style="
          background:#F7F2EA;border-radius:20px;padding:2.4rem 2rem;
          max-width:420px;width:100%;box-shadow:0 8px 40px rgba(61,43,31,0.18);
          text-align:center;
        ">
          <div style="font-size:1.6rem;margin-bottom:0.5rem;">🌿</div>
          <h2 style="color:#3D2B1F;font-size:1.25rem;margin:0 0 0.6rem;font-weight:600;">
            This resource is free — just tell me where to send future ones
          </h2>
          <p style="color:#6B4C3B;font-size:0.88rem;line-height:1.7;margin:0 0 1.4rem;">
            Enter your email and I'll unlock this instantly. One click, no password.
          </p>

          <div id="makoy-gate-step-email">
            ${errorOnLoad ? `
              <p style="color:#C0392B;font-size:0.82rem;margin:0 0 0.8rem;
                         background:#fdecea;border-radius:8px;padding:0.6rem 0.8rem;">
                That link expired or was already used. Request a new one below.
              </p>` : ''}
            <input id="makoy-gate-email" type="email" placeholder="your@email.com"
              autocomplete="email"
              style="
                width:100%;box-sizing:border-box;padding:0.75rem 1rem;
                border:1.5px solid #EDE5D8;border-radius:50px;
                font-size:0.95rem;font-family:Georgia,serif;background:#fff;
                color:#3D2B1F;outline:none;margin-bottom:0.75rem;
              "/>
            <button id="makoy-gate-btn" onclick="makoyGateSend()"
              style="
                width:100%;padding:0.8rem;background:#C4724A;color:#fff;
                border:none;border-radius:50px;font-size:0.95rem;
                font-family:Georgia,serif;font-weight:600;cursor:pointer;
              ">
              Send my link
            </button>
            <p style="color:#9B8B80;font-size:0.72rem;margin:0.8rem 0 0;line-height:1.6;">
              No spam. Unsubscribe any time. Your details stay with Makoy.
            </p>
          </div>

          <div id="makoy-gate-step-sent" style="display:none;">
            <p id="makoy-gate-sent-msg" style="color:#6B4C3B;font-size:0.93rem;line-height:1.7;margin:0 0 1rem;"></p>
            <button onclick="makoyGateResend()"
              style="
                background:none;border:1.5px solid #EDE5D8;border-radius:50px;
                color:#6B4C3B;padding:0.55rem 1.4rem;font-family:Georgia,serif;
                font-size:0.82rem;cursor:pointer;
              ">
              Resend link
            </button>
            <br>
            <button onclick="makoyGateBack()"
              style="
                background:none;border:none;color:#9B8B80;
                font-family:Georgia,serif;font-size:0.78rem;
                cursor:pointer;margin-top:0.6rem;text-decoration:underline;
              ">
              Use a different email
            </button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Focus email input
    setTimeout(() => {
      const inp = document.getElementById('makoy-gate-email');
      if (inp) inp.focus();
    }, 50);

    // Allow Enter key to submit
    document.getElementById('makoy-gate-email').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') makoyGateSend();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectGate);
  } else {
    injectGate();
  }

  // ── Exposed functions (called from inline onclick) ──
  let gateEmail = '';

  window.makoyGateSend = async function () {
    const inp = document.getElementById('makoy-gate-email');
    const btn = document.getElementById('makoy-gate-btn');
    const email = (inp.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      inp.style.borderColor = '#C0392B';
      inp.focus();
      return;
    }
    inp.style.borderColor = '#EDE5D8';
    gateEmail = email;
    btn.textContent = 'Sending…';
    btn.style.opacity = '0.7';
    btn.style.pointerEvents = 'none';
    try {
      const res  = await fetch(`${API}/send-link`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, returnUrl: window.location.href })
      });
      const data = await res.json();
      if (res.ok) {
        if (data.already_verified) {
          localStorage.setItem(LS_KEY, '1');
          document.getElementById('makoy-gate-hide').remove();
          document.getElementById('makoy-gate-overlay').remove();
          return;
        }
        document.getElementById('makoy-gate-sent-msg').textContent =
          `Magic link sent to ${email} — click it to open this resource.`;
        document.getElementById('makoy-gate-step-email').style.display = 'none';
        document.getElementById('makoy-gate-step-sent').style.display  = 'block';
      } else {
        btn.textContent = 'Send my link';
        btn.style.opacity = '';
        btn.style.pointerEvents = '';
        alert(data.error || 'Could not send link. Please try again.');
      }
    } catch (_) {
      btn.textContent = 'Send my link';
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
      alert('Network error — please check your connection.');
    }
  };

  window.makoyGateResend = async function () {
    if (!gateEmail) return;
    try {
      await fetch(`${API}/send-link`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: gateEmail, returnUrl: window.location.href })
      });
    } catch (_) {}
  };

  window.makoyGateBack = function () {
    document.getElementById('makoy-gate-step-sent').style.display  = 'none';
    document.getElementById('makoy-gate-step-email').style.display = 'block';
  };
})();
