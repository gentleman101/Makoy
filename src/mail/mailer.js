const nodemailer = require('nodemailer');

const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const emailBase = (content) => `
<div style="font-family:Georgia,serif;max-width:480px;margin:auto;
            padding:2rem;background:#F7F2EA;border-radius:16px;">
  ${content}
  <hr style="border:none;border-top:1px solid #EDE5D8;margin:1.5rem 0;">
  <p style="color:#D4B896;font-size:0.72rem;text-align:center;margin:0;">
    Katy AI · a Makoy product · makoy.org
  </p>
</div>`;

async function sendMagicLink(email, token, returnUrl) {
  let link = `${process.env.API_URL}/verify?token=${token}&email=${encodeURIComponent(email)}`;
  if (returnUrl) link += `&state=${encodeURIComponent(returnUrl)}`;
  await transporter.sendMail({
    from:    `"Katy from Makoy" <${process.env.SMTP_USER}>`,
    to:      email,
    subject: 'I saved your resources — one click to open them 🌿',
    html: emailBase(`
      <p style="color:#6B4C3B;font-size:1rem;line-height:1.8;margin:0 0 1.2rem;">
        Hi there,
      </p>
      <p style="color:#6B4C3B;font-size:1rem;line-height:1.8;margin:0 0 1.2rem;">
        It's Katy. I put together these HR resources because I know how much time
        gets lost searching for the right frameworks, templates, and thinking —
        especially when you're in the middle of something that actually matters.
      </p>
      <p style="color:#6B4C3B;font-size:1rem;line-height:1.8;margin:0 0 2rem;">
        Click below and everything unlocks instantly. The link is good for
        <strong>30 minutes</strong> and works once — so don't sit on it too long.
      </p>
      <div style="text-align:center;margin:0 0 2rem;">
        <a href="${link}"
           style="background:#C4724A;color:white;padding:0.9rem 2.2rem;
                  border-radius:50px;text-decoration:none;font-weight:600;
                  font-size:1rem;display:inline-block;">
          Open my resources →
        </a>
      </div>
      <p style="color:#9B8B80;font-size:0.85rem;line-height:1.7;margin:0;">
        If something doesn't work or you have a question, just reply to this email —
        it comes straight to me.<br>
        — Katy
      </p>`)
  });
}

async function sendConsultationAlert(data) {
  const { firstName, lastName, email, company, size, challenge, message } = data;
  await transporter.sendMail({
    from:    `"Katy from Makoy" <${process.env.SMTP_USER}>`,
    to:      process.env.TEAM_EMAIL,
    replyTo: email,
    subject: `New consultation request — ${esc(firstName)} ${esc(lastName)} (${esc(company)})`,
    html: emailBase(`
      <h2 style="color:#A05A35;border-bottom:2px solid #EDE5D8;padding-bottom:0.5rem;">
        New Consultation Request 🗓️
      </h2>
      <table style="width:100%;border-collapse:collapse;margin-top:1rem;">
        <tr>
          <td style="padding:0.6rem;color:#6B4C3B;font-weight:600;width:130px;">Name</td>
          <td style="padding:0.6rem;">${esc(firstName)} ${esc(lastName)}</td>
        </tr>
        <tr style="background:#fff;">
          <td style="padding:0.6rem;color:#6B4C3B;font-weight:600;">Email</td>
          <td style="padding:0.6rem;">
            <a href="mailto:${esc(email)}" style="color:#C4724A;">${esc(email)}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:0.6rem;color:#6B4C3B;font-weight:600;">Company</td>
          <td style="padding:0.6rem;">${esc(company)}</td>
        </tr>
        <tr style="background:#fff;">
          <td style="padding:0.6rem;color:#6B4C3B;font-weight:600;">Size</td>
          <td style="padding:0.6rem;">${esc(size)}</td>
        </tr>
        <tr>
          <td style="padding:0.6rem;color:#6B4C3B;font-weight:600;">Challenge</td>
          <td style="padding:0.6rem;">${esc(challenge)}</td>
        </tr>
      </table>
      ${message ? `
        <div style="margin-top:1rem;padding:1rem;background:#fff;
                    border-radius:8px;border-left:3px solid #C4724A;">
          <strong style="color:#6B4C3B;">Additional notes:</strong>
          <p style="margin:0.5rem 0 0;color:#3D2B1F;">${esc(message)}</p>
        </div>` : ''}
      <p style="margin-top:1rem;color:#D4B896;font-size:0.78rem;">
        Sent from makoy.org · ${new Date().toUTCString()}
      </p>`)
  });
}

async function sendConsultationConfirm(data) {
  const { firstName, email } = data;
  await transporter.sendMail({
    from:    `"Katy from Makoy" <${process.env.SMTP_USER}>`,
    to:      email,
    subject: `Got it, ${esc(firstName)} — I'll be in touch soon`,
    html: emailBase(`
      <p style="color:#6B4C3B;font-size:1rem;line-height:1.8;margin:0 0 1.2rem;">
        Hi ${esc(firstName)},
      </p>
      <p style="color:#6B4C3B;font-size:1rem;line-height:1.8;margin:0 0 1.2rem;">
        It's Katy. I've received your message and I'm genuinely looking forward
        to learning more about what's going on at ${esc(data.company)}.
      </p>
      <p style="color:#6B4C3B;font-size:1rem;line-height:1.8;margin:0 0 1.2rem;">
        I'll reach out within <strong>24 hours</strong> to find a time that works
        for a proper conversation — no pitch, just a real chat about your HR challenges
        and whether I can actually help.
      </p>
      <p style="color:#9B8B80;font-size:0.85rem;line-height:1.7;margin:0;">
        In the meantime, if anything comes to mind, just reply here.<br>
        — Katy
      </p>`)
  });
}

module.exports = { sendMagicLink, sendConsultationAlert, sendConsultationConfirm };
