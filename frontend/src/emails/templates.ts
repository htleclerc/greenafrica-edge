/**
 * Templates d'e-mail transactionnels — direction « 1c, transactionnel sobre ».
 *
 * GENERE depuis le projet Claude Design « Templates de mail Supabase »
 * (GreenGate Email Templates.dc.html). Les six pendants GoTrue vivent dans
 * supabase/templates/ et sont cables par supabase/config.toml.
 *
 * HTML en tables inline, 600 px, sans feuille de style externe ni flexbox :
 * Outlook desktop ne sait rendre ni l'un ni l'autre. Ne pas « moderniser ».
 *
 * Les valeurs sont injectees par `renderEmailTemplate`, qui echappe chaque
 * marqueur a la substitution : ne jamais y passer du HTML deja construit.
 *
 * Le logo est servi par le bucket public `assets` de notre projet Supabase.
 * Le livrable pointait vers un projet tiers : une dependance hors de notre
 * controle n'a rien a faire dans un e-mail de production.
 */

/** `tx-proforma-invoice.html` */
export const TX_PROFORMA_INVOICE_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" /><meta name="supported-color-schemes" content="light only" />
<title>{{docName}} {{invoiceRef}}</title>
<!--[if mso]><style>body,table,td,a,p,span{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#F4F4F1;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#F4F4F1;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{{docName}} {{invoiceRef}} — {{amount}} {{badge}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F1;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-top:3px solid #10B981;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">
  <tr><td style="padding:24px 32px 20px;border-bottom:1px solid #EAEAE4;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="30" style="width:30px;"><img src="https://dyjolepwxxsedwngkfox.supabase.co/storage/v1/object/public/assets/africgreen-icon-128.png" alt="" width="30" height="30" style="display:block;width:30px;height:30px;border:0;" /></td>
      <td style="padding-left:11px;font-size:15px;font-weight:600;letter-spacing:-0.2px;color:#141812;">GreenGate</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 20px;font-size:19px;font-weight:600;letter-spacing:-0.2px;color:#141812;">{{docName}} {{invoiceRef}}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">Dear {{recipientName}}, please find attached the {{docNameLower}} for vessel <strong style="color:#141812;">{{vesselName}}</strong>, issued by the Maritime Carbon Tax Authority of the {{jurisdictionName}}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid #EAEAE4;">
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Reference</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{invoiceRef}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Vessel</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{vesselName}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Amount due</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{amount}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Due date</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{dueDate}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Status</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{badge}}</td></tr>
    </table>
    <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="border-left:2px solid #8A6A0B;padding:2px 0 2px 14px;font-size:13px;line-height:1.7;color:#4A5145;">Payment is required within 30 days of issuance. Late payment incurs 1.5% monthly interest.</td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">You can verify the authenticity and current status of this document at any time, or scan the QR code on the PDF.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td bgcolor="#141812" style="border-radius:6px;"><a href="{{verifyUrl}}" style="display:inline-block;padding:12px 24px;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;font-size:14px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:6px;">Verify document status</a></td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;"><span style="font-size:12px;">Quote <strong style="color:#141812;">{{invoiceRef}}</strong> in any correspondence. Invoice questions: billing@greengate.africa.</span></p>
  </td></tr>
  <tr><td style="padding:0 32px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EAEAE4;padding-top:20px;font-size:12px;line-height:1.7;color:#4A5145;">
      Automated message &middot; PDF attached<br />
      Questions <a href="mailto:st.operations@greengate.africa" style="color:#141812;text-decoration:underline;">st.operations@greengate.africa</a> &middot; Invoices <a href="mailto:billing@greengate.africa" style="color:#141812;text-decoration:underline;">billing@greengate.africa</a><br />
      {{jurisdictionName}} &middot; Maritime Carbon Tax Authority
    </td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

/** `tx-payment-confirmation.html` */
export const TX_PAYMENT_CONFIRMATION_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" /><meta name="supported-color-schemes" content="light only" />
<title>Payment received</title>
<!--[if mso]><style>body,table,td,a,p,span{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#F4F4F1;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#F4F4F1;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Payment of {{amount}} confirmed — {{invoiceRef}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F1;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-top:3px solid #10B981;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">
  <tr><td style="padding:24px 32px 20px;border-bottom:1px solid #EAEAE4;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="30" style="width:30px;"><img src="https://dyjolepwxxsedwngkfox.supabase.co/storage/v1/object/public/assets/africgreen-icon-128.png" alt="" width="30" height="30" style="display:block;width:30px;height:30px;border:0;" /></td>
      <td style="padding-left:11px;font-size:15px;font-weight:600;letter-spacing:-0.2px;color:#141812;">GreenGate</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 20px;font-size:19px;font-weight:600;letter-spacing:-0.2px;color:#141812;">Payment received</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">Dear {{recipientName}}, we have received your payment for vessel <strong style="color:#141812;">{{vesselName}}</strong>. Thank you for settling promptly.</p>
    <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="border-left:2px solid #10B981;padding:2px 0 2px 14px;font-size:13px;line-height:1.7;color:#4A5145;">Your account is in good standing. Port clearance has been issued.</td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid #EAEAE4;">
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Invoice</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{invoiceRef}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Receipt</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{receiptRef}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Vessel</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{vesselName}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Amount</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{amount}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Settled on</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{paidAt}}</td></tr>
    </table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">Your official receipt is attached as a PDF. Retain it for your records and tax filings.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td bgcolor="#141812" style="border-radius:6px;"><a href="{{portalUrl}}" style="display:inline-block;padding:12px 24px;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;font-size:14px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:6px;">View transaction record</a></td></tr></table>
  </td></tr>
  <tr><td style="padding:0 32px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EAEAE4;padding-top:20px;font-size:12px;line-height:1.7;color:#4A5145;">
      Automated message &middot; receipt attached<br />
      Questions <a href="mailto:st.operations@greengate.africa" style="color:#141812;text-decoration:underline;">st.operations@greengate.africa</a> &middot; Invoices <a href="mailto:billing@greengate.africa" style="color:#141812;text-decoration:underline;">billing@greengate.africa</a><br />
      {{jurisdictionName}} &middot; Maritime Carbon Tax Authority
    </td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

/** `tx-overdue-reminder.html` */
export const TX_OVERDUE_REMINDER_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" /><meta name="supported-color-schemes" content="light only" />
<title>Overdue payment notice</title>
<!--[if mso]><style>body,table,td,a,p,span{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#F4F4F1;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#F4F4F1;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{{daysOverdue}} days overdue — {{amount}} outstanding</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F1;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-top:3px solid #10B981;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">
  <tr><td style="padding:24px 32px 20px;border-bottom:1px solid #EAEAE4;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="30" style="width:30px;"><img src="https://dyjolepwxxsedwngkfox.supabase.co/storage/v1/object/public/assets/africgreen-icon-128.png" alt="" width="30" height="30" style="display:block;width:30px;height:30px;border:0;" /></td>
      <td style="padding-left:11px;font-size:15px;font-weight:600;letter-spacing:-0.2px;color:#141812;">GreenGate</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 20px;font-size:19px;font-weight:600;letter-spacing:-0.2px;color:#141812;">Overdue payment notice</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">Dear {{recipientName}}, vessel <strong style="color:#141812;">{{vesselName}}</strong> has an overdue carbon tax obligation that requires immediate attention.</p>
    <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="border-left:2px solid #B4231C;padding:2px 0 2px 14px;font-size:13px;line-height:1.7;color:#4A5145;"><strong>Port gate locked.</strong> Clearance is restored once the outstanding balance is settled.</td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid #EAEAE4;">
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Invoice</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{invoiceRef}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Vessel</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{vesselName}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Amount due</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#B4231C;">{{amount}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Days overdue</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#B4231C;">{{daysOverdue}}</td></tr>
    </table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">Late payment incurs 1.5% monthly interest under the Maritime Carbon Tax Act (2024).</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td bgcolor="#141812" style="border-radius:6px;"><a href="{{payUrl}}" style="display:inline-block;padding:12px 24px;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;font-size:14px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:6px;">Settle now</a></td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;"><span style="font-size:12px;">If you believe this notice was issued in error, file a dispute through the portal within 10 business days of issuance, or write to billing@greengate.africa.</span></p>
  </td></tr>
  <tr><td style="padding:0 32px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EAEAE4;padding-top:20px;font-size:12px;line-height:1.7;color:#4A5145;">
      Automated message &middot; do not reply<br />
      Questions <a href="mailto:st.operations@greengate.africa" style="color:#141812;text-decoration:underline;">st.operations@greengate.africa</a> &middot; Invoices <a href="mailto:billing@greengate.africa" style="color:#141812;text-decoration:underline;">billing@greengate.africa</a><br />
      {{jurisdictionName}} &middot; Maritime Carbon Tax Authority
    </td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

/** `tx-agent-invite.html` */
export const TX_AGENT_INVITE_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" /><meta name="supported-color-schemes" content="light only" />
<title>Set up your shipping agent account</title>
<!--[if mso]><style>body,table,td,a,p,span{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#F4F4F1;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#F4F4F1;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{{inviterName}} invited you to GreenGate</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F1;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-top:3px solid #10B981;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">
  <tr><td style="padding:24px 32px 20px;border-bottom:1px solid #EAEAE4;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="30" style="width:30px;"><img src="https://dyjolepwxxsedwngkfox.supabase.co/storage/v1/object/public/assets/africgreen-icon-128.png" alt="" width="30" height="30" style="display:block;width:30px;height:30px;border:0;" /></td>
      <td style="padding-left:11px;font-size:15px;font-weight:600;letter-spacing:-0.2px;color:#141812;">GreenGate</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 20px;font-size:19px;font-weight:600;letter-spacing:-0.2px;color:#141812;">Set up your shipping agent account</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">Dear {{recipientName}}, <strong style="color:#141812;">{{inviterName}}</strong> has invited you to join the GreenGate Sovereign Carbon Platform as a Shipping Agent.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid #EAEAE4;">
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Email</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{email}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Role</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">Shipping Agent</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Organization</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{orgName}}</td></tr>
    </table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">Activate your account and choose your password below. The link is valid for {{ttlHours}} hours and can only be used once.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td bgcolor="#141812" style="border-radius:6px;"><a href="{{inviteUrl}}" style="display:inline-block;padding:12px 24px;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;font-size:14px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:6px;">Activate my account</a></td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;"><span style="font-size:12px;">If the link has expired, ask {{inviterName}} to issue a new invitation. If you were not expecting this, ignore this message &mdash; no account is created until you set a password.</span></p>
  </td></tr>
  <tr><td style="padding:0 32px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EAEAE4;padding-top:20px;font-size:12px;line-height:1.7;color:#4A5145;">
      Automated message &middot; do not reply<br />
      Questions <a href="mailto:st.operations@greengate.africa" style="color:#141812;text-decoration:underline;">st.operations@greengate.africa</a> &middot; Invoices <a href="mailto:billing@greengate.africa" style="color:#141812;text-decoration:underline;">billing@greengate.africa</a><br />
      Republic of Somaliland &middot; Maritime Carbon Tax Authority
    </td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

/** `tx-vessel-access-code.html` */
export const TX_VESSEL_ACCESS_CODE_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" /><meta name="supported-color-schemes" content="light only" />
<title>Your access code</title>
<!--[if mso]><style>body,table,td,a,p,span{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#F4F4F1;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#F4F4F1;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Your GreenGate access code: {{code}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F1;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-top:3px solid #10B981;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">
  <tr><td style="padding:24px 32px 20px;border-bottom:1px solid #EAEAE4;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="30" style="width:30px;"><img src="https://dyjolepwxxsedwngkfox.supabase.co/storage/v1/object/public/assets/africgreen-icon-128.png" alt="" width="30" height="30" style="display:block;width:30px;height:30px;border:0;" /></td>
      <td style="padding-left:11px;font-size:15px;font-weight:600;letter-spacing:-0.2px;color:#141812;">GreenGate</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 20px;font-size:19px;font-weight:600;letter-spacing:-0.2px;color:#141812;">Your access code</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">Dear {{recipientName}}, use the code below to link your account and access your vessel&rsquo;s carbon tax records on GreenGate.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="border:1px solid #EAEAE4;border-radius:6px;padding:18px 20px;">
      <div style="font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;letter-spacing:1.4px;color:#6E766A;padding-bottom:8px;">ACCESS CODE</div>
      <div style="font-family:'IBM Plex Mono',Consolas,monospace;font-size:26px;font-weight:500;letter-spacing:6px;color:#141812;">{{code}}</div>
    </td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;border-top:1px solid #EAEAE4;"><tr><td style="padding-top:18px;font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;line-height:2;color:#4A5145;">
      <span style="color:#6E766A;">EXPIRES</span>&nbsp;&nbsp;15 min<br />
      <span style="color:#6E766A;">SINGLE USE</span>&nbsp;&nbsp;yes
    </td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;"><span style="font-size:12px;">If you did not request this code, ignore this message &mdash; no account changes will be made.</span></p>
  </td></tr>
  <tr><td style="padding:0 32px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EAEAE4;padding-top:20px;font-size:12px;line-height:1.7;color:#4A5145;">
      Automated message &middot; do not reply<br />
      Questions <a href="mailto:st.operations@greengate.africa" style="color:#141812;text-decoration:underline;">st.operations@greengate.africa</a> &middot; Invoices <a href="mailto:billing@greengate.africa" style="color:#141812;text-decoration:underline;">billing@greengate.africa</a><br />
      Republic of Somaliland &middot; Maritime Carbon Tax Authority
    </td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

/** `tx-monthly-statement.html` */
export const TX_MONTHLY_STATEMENT_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" /><meta name="supported-color-schemes" content="light only" />
<title>Account statement &mdash; {{periodLabel}}</title>
<!--[if mso]><style>body,table,td,a,p,span{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#F4F4F1;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#F4F4F1;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Statement {{periodLabel}} — {{amount}} outstanding</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F1;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-top:3px solid #10B981;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">
  <tr><td style="padding:24px 32px 20px;border-bottom:1px solid #EAEAE4;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="30" style="width:30px;"><img src="https://dyjolepwxxsedwngkfox.supabase.co/storage/v1/object/public/assets/africgreen-icon-128.png" alt="" width="30" height="30" style="display:block;width:30px;height:30px;border:0;" /></td>
      <td style="padding-left:11px;font-size:15px;font-weight:600;letter-spacing:-0.2px;color:#141812;">GreenGate</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 20px;font-size:19px;font-weight:600;letter-spacing:-0.2px;color:#141812;">Account statement &mdash; {{periodLabel}}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">Dear {{recipientName}}, your account statement for <strong style="color:#141812;">{{periodLabel}}</strong> is available and attached to this message.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid #EAEAE4;">
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Period</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{periodLabel}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Invoices issued</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{invoiceCount}}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-size:13px;color:#6E766A;">Total outstanding</td><td align="right" style="padding:11px 0;border-bottom:1px solid #EAEAE4;font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;color:#141812;">{{amount}}</td></tr>
    </table>
    <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="border-left:2px solid #8A6A0B;padding:2px 0 2px 14px;font-size:13px;line-height:1.7;color:#4A5145;">This is an informational statement, not an invoice. Open pro-formas remain payable from your portal.</td></tr></table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td bgcolor="#141812" style="border-radius:6px;"><a href="{{portalUrl}}" style="display:inline-block;padding:12px 24px;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;font-size:14px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:6px;">View statements</a></td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;"><span style="font-size:12px;">Statement questions: billing@greengate.africa.</span></p>
  </td></tr>
  <tr><td style="padding:0 32px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EAEAE4;padding-top:20px;font-size:12px;line-height:1.7;color:#4A5145;">
      Automated message &middot; statement attached<br />
      Questions <a href="mailto:st.operations@greengate.africa" style="color:#141812;text-decoration:underline;">st.operations@greengate.africa</a> &middot; Invoices <a href="mailto:billing@greengate.africa" style="color:#141812;text-decoration:underline;">billing@greengate.africa</a><br />
      {{jurisdictionName}} &middot; Maritime Carbon Tax Authority
    </td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

/** `tx-sign-in-link.html` - lien de connexion, armateur comme staff. */
export const TX_SIGN_IN_LINK_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" /><meta name="supported-color-schemes" content="light only" />
<title>Your sign-in link</title>
<!--[if mso]><style>body,table,td,a,p,span{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#F4F4F1;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#F4F4F1;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Sign in to GreenGate &mdash; link and code valid for 60 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F1;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-top:3px solid #10B981;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">
  <tr><td style="padding:24px 32px 20px;border-bottom:1px solid #EAEAE4;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="30" style="width:30px;"><img src="https://tvvvsysyiugrkrottczt.supabase.co/storage/v1/object/public/assets/africgreen-icon-128.png" alt="" width="30" height="30" style="display:block;width:30px;height:30px;border:0;" /></td>
      <td style="padding-left:11px;font-size:15px;font-weight:600;letter-spacing:-0.2px;color:#141812;">GreenGate</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 20px;font-size:19px;font-weight:600;letter-spacing:-0.2px;color:#141812;">Your sign-in link</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">Use the link below to sign in to your GreenGate account. No password required.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td bgcolor="#141812" style="border-radius:6px;"><a href="{{link}}" style="display:inline-block;padding:12px 24px;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;font-size:14px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:6px;">Sign in</a></td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="border:1px solid #EAEAE4;border-radius:6px;padding:18px 20px;">
      <div style="font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;letter-spacing:1.4px;color:#6E766A;padding-bottom:8px;">OR ENTER THIS CODE ON THE PORTAL</div>
      <div style="font-family:'IBM Plex Mono',Consolas,monospace;font-size:26px;font-weight:500;letter-spacing:6px;color:#141812;">{{code}}</div>
    </td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;border-top:1px solid #EAEAE4;"><tr><td style="padding-top:18px;font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;line-height:2;color:#4A5145;">
      <span style="color:#6E766A;">ACCOUNT</span>&nbsp;&nbsp;{{email}}<br />
      <span style="color:#6E766A;">VESSEL</span>&nbsp;&nbsp;{{vessel}}<br />
      <span style="color:#6E766A;">EXPIRES</span>&nbsp;&nbsp;60 min<br />
      <span style="color:#6E766A;">SINGLE USE</span>&nbsp;&nbsp;yes
    </td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;"><span style="font-size:12px;">If you did not request this link, ignore this message. Your account stays protected.</span></p>
  </td></tr>
  <tr><td style="padding:0 32px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EAEAE4;padding-top:20px;font-size:12px;line-height:1.7;color:#4A5145;">
      Automated message &middot; do not reply<br />
      Questions <a href="mailto:st.operations@greengate.africa" style="color:#141812;text-decoration:underline;">st.operations@greengate.africa</a> &middot; Invoices <a href="mailto:billing@greengate.africa" style="color:#141812;text-decoration:underline;">billing@greengate.africa</a><br />
      Republic of Somaliland &middot; Maritime Carbon Tax Authority
    </td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

/** `tx-staff-invite.html` - invitation d'un agent de la plateforme. */
export const TX_STAFF_INVITE_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" /><meta name="supported-color-schemes" content="light only" />
<title>You have been invited to GreenGate</title>
<!--[if mso]><style>body,table,td,a,p,span{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#F4F4F1;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#F4F4F1;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Accept your invitation to the GreenGate carbon tax portal.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F1;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-top:3px solid #10B981;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">
  <tr><td style="padding:24px 32px 20px;border-bottom:1px solid #EAEAE4;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="30" style="width:30px;"><img src="https://tvvvsysyiugrkrottczt.supabase.co/storage/v1/object/public/assets/africgreen-icon-128.png" alt="" width="30" height="30" style="display:block;width:30px;height:30px;border:0;" /></td>
      <td style="padding-left:11px;font-size:15px;font-weight:600;letter-spacing:-0.2px;color:#141812;">GreenGate</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 20px;font-size:19px;font-weight:600;letter-spacing:-0.2px;color:#141812;">You have been invited to GreenGate</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">You have been invited to join the GreenGate Sovereign Carbon Platform. Accept the invitation below to set your password and activate your account.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td bgcolor="#141812" style="border-radius:6px;"><a href="{{link}}" style="display:inline-block;padding:12px 24px;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;font-size:14px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:6px;">Accept the invitation</a></td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;border-top:1px solid #EAEAE4;"><tr><td style="padding-top:18px;font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;line-height:2;color:#4A5145;">
      <span style="color:#6E766A;">ACCOUNT</span>&nbsp;&nbsp;{{email}}<br />
      <span style="color:#6E766A;">ROLE</span>&nbsp;&nbsp;{{role}}<br />
      <span style="color:#6E766A;">EXPIRES</span>&nbsp;&nbsp;24 h
    </td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;"><span style="font-size:12px;">If you were not expecting this invitation, ignore this message &mdash; no account will be created until you set a password.</span></p>
  </td></tr>
  <tr><td style="padding:0 32px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EAEAE4;padding-top:20px;font-size:12px;line-height:1.7;color:#4A5145;">
      Automated message &middot; do not reply<br />
      Questions <a href="mailto:st.operations@greengate.africa" style="color:#141812;text-decoration:underline;">st.operations@greengate.africa</a> &middot; Invoices <a href="mailto:billing@greengate.africa" style="color:#141812;text-decoration:underline;">billing@greengate.africa</a><br />
      Republic of Somaliland &middot; Maritime Carbon Tax Authority
    </td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

/** `tx-password-reset.html` - reinitialisation de mot de passe. */
export const TX_PASSWORD_RESET_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" /><meta name="supported-color-schemes" content="light only" />
<title>Reset your password</title>
<!--[if mso]><style>body,table,td,a,p,span{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#F4F4F1;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#F4F4F1;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Choose a new password for your GreenGate account.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F1;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-top:3px solid #10B981;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">
  <tr><td style="padding:24px 32px 20px;border-bottom:1px solid #EAEAE4;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="30" style="width:30px;"><img src="https://tvvvsysyiugrkrottczt.supabase.co/storage/v1/object/public/assets/africgreen-icon-128.png" alt="" width="30" height="30" style="display:block;width:30px;height:30px;border:0;" /></td>
      <td style="padding-left:11px;font-size:15px;font-weight:600;letter-spacing:-0.2px;color:#141812;">GreenGate</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 20px;font-size:19px;font-weight:600;letter-spacing:-0.2px;color:#141812;">Reset your password</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;">Use the link below to choose a new password for your GreenGate account.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td bgcolor="#141812" style="border-radius:6px;"><a href="{{link}}" style="display:inline-block;padding:12px 24px;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;font-size:14px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:6px;">Choose a new password</a></td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;border-top:1px solid #EAEAE4;"><tr><td style="padding-top:18px;font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;line-height:2;color:#4A5145;">
      <span style="color:#6E766A;">ACCOUNT</span>&nbsp;&nbsp;{{email}}<br />
      <span style="color:#6E766A;">EXPIRES</span>&nbsp;&nbsp;60 min<br />
      <span style="color:#6E766A;">SINGLE USE</span>&nbsp;&nbsp;yes
    </td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4A5145;"><span style="font-size:12px;">If you did not ask for this, ignore this message &mdash; your current password stays valid.</span></p>
  </td></tr>
  <tr><td style="padding:0 32px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EAEAE4;padding-top:20px;font-size:12px;line-height:1.7;color:#4A5145;">
      Automated message &middot; do not reply<br />
      Questions <a href="mailto:st.operations@greengate.africa" style="color:#141812;text-decoration:underline;">st.operations@greengate.africa</a> &middot; Invoices <a href="mailto:billing@greengate.africa" style="color:#141812;text-decoration:underline;">billing@greengate.africa</a><br />
      Republic of Somaliland &middot; Maritime Carbon Tax Authority
    </td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
