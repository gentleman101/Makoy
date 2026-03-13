/**
 * gate.js — Makoy resource gate
 * Include as the first <script> in any /resources/ page <head>.
 * Same device (localStorage) → page shows immediately, no overlay.
 * First visit → full-page email capture overlay.
 */
(function () {
  const API    = 'https://api.makoy.org';
  const LS_KEY = 'makoy_unlocked';

  // Same device: already verified — do nothing
  if (localStorage.getItem(LS_KEY) === '1') return;

  const params = new URLSearchParams(window.location.search);

  // Returning from magic link with success
  if (params.get('unlocked') === '1') {
    localStorage.setItem(LS_KEY, '1');
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    return;
  }

  // Returning with error (expired/used link)
  const hadError = params.get('unlocked') === 'error';
  if (hadError) {
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }

  // Hide page until verified
  var hideStyle = document.createElement('style');
  hideStyle.id  = 'makoy-gate-hide';
  hideStyle.textContent = 'body > *:not(#makoy-gate) { visibility: hidden !important; }';
  document.head.appendChild(hideStyle);

  function showGate() {
    var el = document.createElement('div');
    el.id  = 'makoy-gate';
    el.innerHTML = '<div style="position:fixed;inset:0;z-index:99999;background:rgba(61,43,31,0.55);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:1.5rem;font-family:Georgia,serif;">' +
      '<div style="background:#F7F2EA;border-radius:20px;padding:2.4rem 2rem;max-width:420px;width:100%;box-shadow:0 8px 40px rgba(61,43,31,0.18);text-align:center;">' +
        '<div style="font-size:1.5rem;margin-bottom:0.5rem;">🌿</div>' +
        '<h2 style="color:#3D2B1F;font-size:1.2rem;margin:0 0 0.5rem;font-weight:600;">Free to read — just leave your email</h2>' +
        '<p style="color:#6B4C3B;font-size:0.88rem;line-height:1.7;margin:0 0 1.4rem;">One click, no password. I\'ll also send future resources your way.</p>' +
        '<div id="makoy-gate-form">' +
          (hadError ? '<p style="color:#C0392B;font-size:0.8rem;margin:0 0 0.75rem;background:#fdecea;border-radius:8px;padding:0.55rem 0.8rem;">That link expired or was already used. Request a new one.</p>' : '') +
          '<input id="makoy-gate-email" type="email" placeholder="your@email.com" autocomplete="email" style="width:100%;box-sizing:border-box;padding:0.75rem 1rem;border:1.5px solid #EDE5D8;border-radius:50px;font-size:0.9rem;font-family:Georgia,serif;background:#fff;color:#3D2B1F;outline:none;margin-bottom:0.7rem;" />' +
          '<button id="makoy-gate-btn" onclick="makoyGateSend()" style="width:100%;padding:0.8rem;background:#C4724A;color:#fff;border:none;border-radius:50px;font-size:0.95rem;font-family:Georgia,serif;font-weight:600;cursor:pointer;">Unlock resource</button>' +
          '<p style="color:#9B8B80;font-size:0.7rem;margin:0.7rem 0 0;line-height:1.5;">No spam. Unsubscribe any time.</p>' +
        '</div>' +
        '<div id="makoy-gate-sent" style="display:none;">' +
          '<p id="makoy-gate-sent-msg" style="color:#6B4C3B;font-size:0.9rem;line-height:1.7;margin:0 0 1rem;"></p>' +
          '<button onclick="makoyGateResend()" style="background:none;border:1.5px solid #EDE5D8;border-radius:50px;color:#6B4C3B;padding:0.5rem 1.2rem;font-family:Georgia,serif;font-size:0.8rem;cursor:pointer;">Resend link</button>' +
          '<br><button onclick="makoyGateBack()" style="background:none;border:none;color:#9B8B80;font-family:Georgia,serif;font-size:0.75rem;cursor:pointer;margin-top:0.5rem;text-decoration:underline;">Use a different email</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.body.appendChild(el);

    var inp = document.getElementById('makoy-gate-email');
    if (inp) {
      setTimeout(function () { inp.focus(); }, 60);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') makoyGateSend(); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showGate);
  } else {
    showGate();
  }

  var gateEmail = '';

  window.makoyGateSend = async function () {
    var inp   = document.getElementById('makoy-gate-email');
    var btn   = document.getElementById('makoy-gate-btn');
    var email = (inp.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      inp.style.borderColor = '#C0392B'; inp.focus(); return;
    }
    inp.style.borderColor = '#EDE5D8';
    gateEmail = email;
    btn.textContent = 'Sending\u2026'; btn.style.opacity = '0.7'; btn.style.pointerEvents = 'none';
    try {
      var res  = await fetch(API + '/send-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, returnUrl: window.location.href })
      });
      var data = await res.json();
      if (res.ok) {
        if (data.already_verified) {
          localStorage.setItem(LS_KEY, '1');
          document.getElementById('makoy-gate-hide').remove();
          document.getElementById('makoy-gate').remove();
          return;
        }
        document.getElementById('makoy-gate-sent-msg').textContent =
          'Magic link sent to ' + email + ' \u2014 click it to open this resource.';
        document.getElementById('makoy-gate-form').style.display = 'none';
        document.getElementById('makoy-gate-sent').style.display = 'block';
      } else {
        btn.textContent = 'Unlock resource'; btn.style.opacity = ''; btn.style.pointerEvents = '';
        alert(data.error || 'Could not send link. Please try again.');
      }
    } catch (_) {
      btn.textContent = 'Unlock resource'; btn.style.opacity = ''; btn.style.pointerEvents = '';
      alert('Network error \u2014 please check your connection.');
    }
  };

  window.makoyGateResend = async function () {
    if (!gateEmail) return;
    try {
      await fetch(API + '/send-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: gateEmail, returnUrl: window.location.href })
      });
    } catch (_) {}
  };

  window.makoyGateBack = function () {
    document.getElementById('makoy-gate-sent').style.display = 'none';
    document.getElementById('makoy-gate-form').style.display = 'block';
  };
})();
