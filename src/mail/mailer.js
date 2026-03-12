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

async function sendMagicLink(email, token) {
  const link = `${process.env.API_URL}/verify?token=${token}&email=${encodeURIComponent(email)}`;
  await transporter.sendMail({
    from:    `"Katy AI by Makoy" <${process.env.SMTP_USER}>`,
    to:      email,
    subject: 'Your free resources from Katy AI',
    html: emailBase(`
      <div style="text-align:center;margin-bottom:1.5rem;">
        <span style="font-size:2rem;">🫐</span>
        <h2 style="color:#A05A35;margin:0.5rem 0 0;font-size:1.4rem;">
          You're one click away
        </h2>
      </div>
      <p style="color:#6B4C3B;line-height:1.7;">
        Click below to instantly unlock your free HR resources.
        This link expires in <strong>30 minutes</strong> and works once only.
      </p>
      <div style="text-align:center;margin:2rem 0;">
        <a href="${link}"
           style="background:#C4724A;color:white;padding:0.9rem 2.2rem;
                  border-radius:50px;text-decoration:none;font-weight:600;
                  font-size:1rem;display:inline-block;">
          Unlock My Resources →
        </a>
      </div>
      <p style="color:#D4B896;font-size:0.78rem;text-align:center;">
        If you didn't request this, simply ignore this email.
      </p>`)
  });
}

async function sendConsultationAlert(data) {
  const { firstName, lastName, email, company, size, challenge, message } = data;
  await transporter.sendMail({
    from:    `"Katy AI Website" <${process.env.SMTP_USER}>`,
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

module.exports = { sendMagicLink, sendConsultationAlert };
