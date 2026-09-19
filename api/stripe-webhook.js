// api/stripe-webhook.js
//
// Empfängt Stripe-Webhook-Events und aktualisiert den Abo-Status in der
// companies-Tabelle über den Supabase Service-Role-Key (umgeht RLS bewusst,
// da diese Funktion server-seitig läuft und selbst validiert).
//
// WICHTIG: SUPABASE_SERVICE_ROLE_KEY niemals im Frontend verwenden — nur
// hier, als Vercel Environment Variable, niemals ins Repo committen.
//
// In Stripe unter Developers > Webhooks eine Endpoint-URL anlegen:
// https://klima-protokoll.de/api/stripe-webhook
// Events: checkout.session.completed, customer.subscription.updated,
//         customer.subscription.deleted

import crypto from 'crypto';

export const config = {
  api: { bodyParser: false }, // Rohdaten werden für die Signaturprüfung benötigt
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  const signedPayload = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}

async function updateCompany(companyId, fields) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${supabaseUrl}/rest/v1/companies?id=eq.${companyId}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(fields),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Noch nicht konfiguriert — bewusst kontrolliert ablehnen statt ungeprüft zu verarbeiten.
    return res.status(503).json({ error: 'Webhook ist noch nicht konfiguriert.' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  const valid = verifyStripeSignature(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);

  if (!valid) {
    return res.status(400).json({ error: 'Ungültige Stripe-Signatur.' });
  }

  const event = JSON.parse(rawBody);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const companyId = session.client_reference_id || session.metadata?.company_id;
        if (companyId) {
          await updateCompany(companyId, {
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            subscription_status: 'active', // kein Stripe-Trial mehr, Zahlung ist sofort erfolgt
          });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const companyId = sub.metadata?.company_id;
        if (companyId) {
          await updateCompany(companyId, {
            subscription_status: sub.status,
            trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          });
        }
        break;
      }
      default:
        break; // andere Event-Typen ignorieren wir bewusst
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook-Verarbeitungsfehler:', err);
    return res.status(500).json({ error: 'Fehler beim Verarbeiten des Webhooks.' });
  }
}
