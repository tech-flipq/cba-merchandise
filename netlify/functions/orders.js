const { google } = require('googleapis');
const crypto = require('node:crypto');

const CONFIG = {
  MAX_QTY_PER_SIZE: 10,
  MAX_TOTAL_QUANTITY: 50,
  ORDERS_SHEET: 'Orders',
  RECAPTCHA_ACTION: 'submit_order',
  RECAPTCHA_MIN_SCORE: 0.7
};

const PRODUCT_CATALOG = {
  K24: { id: 'K24', label: '24', price: 499, priceType: 'regular' },
  K26: { id: 'K26', label: '26', price: 499, priceType: 'regular' },
  K28: { id: 'K28', label: '28', price: 499, priceType: 'regular' },
  K30: { id: 'K30', label: '30', price: 499, priceType: 'regular' },
  K32: { id: 'K32', label: '32', price: 499, priceType: 'regular' },
  K34: { id: 'K34', label: '34', price: 499, priceType: 'regular' },
  S:   { id: 'S',   label: 'S / 36',   price: 499, priceType: 'regular' },
  M:   { id: 'M',   label: 'M / 38',   price: 499, priceType: 'regular' },
  L:   { id: 'L',   label: 'L / 40',   price: 499, priceType: 'regular' },
  XL:  { id: 'XL',  label: 'XL / 42',  price: 499, priceType: 'regular' },
  '2XL': { id: '2XL', label: '2XL / 44', price: 499, priceType: 'regular' },
  '3XL': { id: '3XL', label: '3XL / 46', price: 499, priceType: 'regular' },
  '4XL': { id: '4XL', label: '4XL / 48', price: 499, priceType: 'regular' },
  P50: { id: 'P50', label: '50', price: 599, priceType: 'plus' },
  P52: { id: 'P52', label: '52', price: 599, priceType: 'plus' },
  P54: { id: 'P54', label: '54', price: 599, priceType: 'plus' },
  P56: { id: 'P56', label: '56', price: 599, priceType: 'plus' }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, message: 'Method not allowed.' });
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const customer = validateCustomer(payload);

    await verifyRecaptcha(payload.recaptchaToken);

    const order = calculateOrder(payload.items);
    if (order.totalQuantity <= 0) {
      throw new Error('Please select at least one T-shirt.');
    }

    const sheets = createSheetsClient();
    const duplicate = await transactionReferenceExists(
      sheets,
      customer.transactionReference
    );

    if (duplicate) {
      throw new Error(
        'This payment transaction reference has already been submitted.'
      );
    }

    const orderNumber = generateOrderNumber();
    const orderDescription = order.items
      .map((item) => `${item.label} × ${item.quantity}`)
      .join(' | ');

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
      range: `${CONFIG.ORDERS_SHEET}!A:O`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          new Date().toISOString(),
          orderNumber,
          sanitizeSpreadsheetValue(customer.name),
          sanitizeSpreadsheetValue(customer.email),
          sanitizeSpreadsheetValue(customer.phone),
          order.totalQuantity,
          order.regularQuantity,
          order.plusQuantity,
          order.regularAmount,
          order.plusAmount,
          order.totalAmount,
          sanitizeSpreadsheetValue(orderDescription),
          JSON.stringify(order.items),
          sanitizeSpreadsheetValue(customer.transactionReference),
          'PAYMENT_REFERENCE_RECEIVED'
        ]]
      }
    });

    return response(200, {
      success: true,
      orderNumber,
      totalQuantity: order.totalQuantity,
      totalAmount: order.totalAmount,
      message: 'Your order has been received successfully.'
    });

  } catch (error) {
    console.error('Order submission failed:', error);
    return response(400, {
      success: false,
      message: getSafeErrorMessage(error)
    });
  }
};

function validateCustomer(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid order submission.');
  }

  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const phone = String(payload.contactNumber || '').replace(/\D/g, '');
  const transactionReference = normalizeTransactionReference(
    payload.transactionReference
  );

  if (name.length < 2 || name.length > 100) {
    throw new Error('Please enter your full name.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address.');
  }

  if (!/^[6-9]\d{9}$/.test(phone)) {
    throw new Error('Please enter a valid 10-digit mobile number.');
  }

  if (transactionReference.length < 6 || transactionReference.length > 50) {
    throw new Error('Please enter a valid payment transaction reference.');
  }

  if (!/^[A-Za-z0-9_-]+$/.test(transactionReference)) {
    throw new Error('Please enter a valid payment transaction reference.');
  }

  return { name, email, phone, transactionReference };
}

function calculateOrder(items) {
  if (!Array.isArray(items)) {
    throw new Error('Invalid order items.');
  }

  let totalQuantity = 0;
  let regularQuantity = 0;
  let plusQuantity = 0;
  let regularAmount = 0;
  let plusAmount = 0;
  const calculatedItems = [];
  const seen = new Set();

  items.forEach((item) => {
    if (!item || typeof item !== 'object') return;

    const productId = String(item.id || '').trim();
    if (!productId) return;

    const product = PRODUCT_CATALOG[productId];
    if (!product) throw new Error('Invalid T-shirt size selected.');
    if (seen.has(productId)) throw new Error('Duplicate T-shirt size detected.');
    seen.add(productId);

    const quantity = Number(item.quantity || 0);
    if (
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      quantity > CONFIG.MAX_QTY_PER_SIZE
    ) {
      throw new Error('Invalid quantity selected.');
    }

    if (quantity === 0) return;

    const amount = quantity * product.price;
    totalQuantity += quantity;

    if (product.priceType === 'plus') {
      plusQuantity += quantity;
      plusAmount += amount;
    } else {
      regularQuantity += quantity;
      regularAmount += amount;
    }

    calculatedItems.push({
      id: product.id,
      label: product.label,
      quantity,
      unitPrice: product.price,
      amount
    });
  });

  if (totalQuantity > CONFIG.MAX_TOTAL_QUANTITY) {
    throw new Error(
      `Maximum total order quantity is ${CONFIG.MAX_TOTAL_QUANTITY}.`
    );
  }

  return {
    items: calculatedItems,
    totalQuantity,
    regularQuantity,
    plusQuantity,
    regularAmount,
    plusAmount,
    totalAmount: regularAmount + plusAmount
  };
}

function createSheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Server configuration error.');
  }

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({ version: 'v4', auth });
}

async function transactionReferenceExists(sheets, reference) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    range: `${CONFIG.ORDERS_SHEET}!N2:N`
  });

  const rows = result.data.values || [];
  const normalized = normalizeTransactionReference(reference);
  return rows.some((row) =>
    normalizeTransactionReference(row[0] || '') === normalized
  );
}

async function verifyRecaptcha(token) {
  if (!token || !process.env.RECAPTCHA_SECRET_KEY) {
    throw new Error('Security verification failed.');
  }

  const body = new URLSearchParams({
    secret: process.env.RECAPTCHA_SECRET_KEY,
    response: token
  });

  const result = await fetch(
    'https://www.google.com/recaptcha/api/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }
  ).then((r) => r.json());

  if (
    !result.success ||
    result.action !== CONFIG.RECAPTCHA_ACTION ||
    Number(result.score) < CONFIG.RECAPTCHA_MIN_SCORE
  ) {
    throw new Error('Security verification failed.');
  }
}

function normalizeTransactionReference(value) {
  return String(value || '').trim().toUpperCase();
}

function sanitizeSpreadsheetValue(value) {
  let text = String(value == null ? '' : value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return text;
}

function generateOrderNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
  const random = crypto.randomInt(100, 1000);
  return `CBA26-${stamp}-${random}`;
}

function getSafeErrorMessage(error) {
  const allowed = [
    'Invalid order submission.',
    'Please enter your full name.',
    'Please enter a valid email address.',
    'Please enter a valid 10-digit mobile number.',
    'Please enter a valid payment transaction reference.',
    'Please select at least one T-shirt.',
    'Invalid order items.',
    'Invalid T-shirt size selected.',
    'Duplicate T-shirt size detected.',
    'Invalid quantity selected.',
    'This payment transaction reference has already been submitted.',
    'Security verification failed.',
    `Maximum total order quantity is ${CONFIG.MAX_TOTAL_QUANTITY}.`
  ];

  if (error && allowed.includes(error.message)) return error.message;
  return 'Unable to submit your order. Please try again.';
}
