const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const PLAN_LIMITS = {
  basic: { maxProducts: 10, categories: false, variations: false },
  pro: { maxProducts: 999, categories: true, variations: false },
  premium: { maxProducts: 999, categories: true, variations: true },
};

const PLAN_PRICES = { basic: 3, pro: 5, premium: 7 };

function delay(min = 1000, max = 3000) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

function formatNumber(n) {
  return n.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
}

function isOwner(jid, business) {
  return jid.includes(business.wa_number.replace(/[^0-9]/g, ''));
}

function isBusinessClosed(settings) {
  if (!settings.closed_start || !settings.closed_end) return false;
  const now = new Date();
  const [sh, sm] = settings.closed_start.split(':').map(Number);
  const [eh, em] = settings.closed_end.split(':').map(Number);
  const current = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start > end) return current >= start || current < end;
  return current >= start && current < end;
}

function daysLeft(expiresAt) {
  const diff = new Date(expiresAt) - new Date();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

async function startBusinessBot(business, onSessionUpdate, onLog) {
  const sessionDir = path.join(__dirname, 'sessions', business.wa_number);
  fs.mkdirSync(sessionDir, { recursive: true });

  if (business.session_data) {
    try {
      const sessionObj = JSON.parse(Buffer.from(business.session_data, 'base64').toString());
      fs.writeFileSync(path.join(sessionDir, 'creds.json'), JSON.stringify(sessionObj));
    } catch (e) {}
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['Kidjustin-Shop', 'Chrome', '120.0'],
    generateHighQualityLinkPreview: false,
    msgRetryCounterMap: {},
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    const credsData = fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf8');
    const encoded = Buffer.from(credsData).toString('base64');
    await db.updateBusinessSession(business.wa_number, encoded);
    if (onSessionUpdate) onSessionUpdate(encoded);
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && onLog) onLog({ type: 'qr', qr, number: business.wa_number });
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      if (onLog) onLog({ type: 'disconnect', code, number: business.wa_number });
      if (shouldReconnect) {
        setTimeout(() => startBusinessBot(business, onSessionUpdate, onLog), 5000);
      }
    }
    if (connection === 'open') {
      if (onLog) onLog({ type: 'connected', number: business.wa_number });
      await db.updateBusinessStatus(business.wa_number, 'active');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      try {
        await handleMessage(sock, msg, business);
      } catch (e) {
        if (onLog) onLog({ type: 'error', message: e.message, number: business.wa_number });
      }
    }
  });

  return sock;
}

async function handleMessage(sock, msg, business) {
  const jid = msg.key.remoteJid;
  if (!jid || jid.includes('@g.us')) return;

  const settings = await db.getSettings(business.id);
  const text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    ''
  ).trim();

  const senderJid = jid;
  const senderNumber = jid.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
  const ownerMsg = isOwner(jid, business);

  await delay(800, 2500);

  if (isBusinessClosed(settings) && !ownerMsg) {
    await sock.sendMessage(jid, {
      text: settings.closed_message || 'We are currently closed. Please message us during business hours.',
    });
    return;
  }

  if (ownerMsg) {
    await handleOwnerCommand(sock, jid, text, msg, business, settings);
    return;
  }

  await handleCustomerMessage(sock, jid, senderNumber, text, msg, business, settings);
}

async function handleOwnerCommand(sock, jid, text, msg, business, settings) {
  const lower = text.toLowerCase();
  const args = text.split(' ');
  const cmd = args[0].toLowerCase();

  if (cmd === '.help' || cmd === '.menu') {
    await sock.sendMessage(jid, {
      text: `🏪 *${settings.shop_name || 'Your Shop'} — Owner Panel*\n\n` +
        `📦 *Products*\n` +
        `• .addproduct Name | Price | Description | Category\n  _(attach a photo with the command)_\n` +
        `• .removeproduct [name]\n` +
        `• .products — view all products\n\n` +
        `📋 *Orders*\n` +
        `• .orders — view pending orders\n` +
        `• .allorders — view all orders\n` +
        `• .update [order#] [status]\n  _(status: confirmed / paid / preparing / delivered / cancelled)_\n\n` +
        `⚙️ *Settings*\n` +
        `• .setshopname [name]\n` +
        `• .setaddress [full address]\n` +
        `• .setwelcome [message]\n` +
        `• .setpayment [details]\n` +
        `• .setclosed [HH:MM] [HH:MM] _(start end)_\n` +
        `• .setcurrency [USD/ZWG/ZAR]\n` +
        `• .settings — view all settings\n\n` +
        `📊 *Stats*\n` +
        `• .stats — orders and revenue summary\n` +
        `• .subscription — your plan details`,
    });
    return;
  }

  if (cmd === '.addproduct') {
    const limits = PLAN_LIMITS[business.plan];
    const existing = await db.getProducts(business.id);
    if (existing.length >= limits.maxProducts) {
      await sock.sendMessage(jid, {
        text: `⚠️ You've reached the product limit for your *${business.plan}* plan (${limits.maxProducts} products).\nUpgrade to add more.`,
      });
      return;
    }

    const parts = text.replace('.addproduct ', '').split('|').map(s => s.trim());
    if (parts.length < 2) {
      await sock.sendMessage(jid, {
        text: '❌ Format: .addproduct Name | Price | Description | Category\nAttach a photo if you want one.',
      });
      return;
    }

    const [name, priceStr, description, category] = parts;
    const price = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
    if (!name || isNaN(price)) {
      await sock.sendMessage(jid, { text: '❌ Invalid product format. Use: .addproduct Name | Price | Description' });
      return;
    }

    let imageBuffer = null;
    if (msg.message?.imageMessage) {
      try {
        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
        const buf = await downloadMediaMessage(msg, 'buffer', {});
        imageBuffer = buf;
      } catch (e) {}
    }

    await db.addProduct(business.id, name, price, description || '', category || 'General', imageBuffer);
    await sock.sendMessage(jid, {
      text: `✅ *${name}* added to catalogue!\n💵 Price: ${settings.currency || 'USD'} ${price.toFixed(2)}`,
    });
    return;
  }

  if (cmd === '.removeproduct') {
    const name = args.slice(1).join(' ');
    if (!name) {
      await sock.sendMessage(jid, { text: '❌ Usage: .removeproduct [product name]' });
      return;
    }
    await db.removeProduct(business.id, name);
    await sock.sendMessage(jid, { text: `🗑️ *${name}* removed from catalogue.` });
    return;
  }

  if (cmd === '.products') {
    const products = await db.getProducts(business.id);
    if (!products.length) {
      await sock.sendMessage(jid, { text: '📦 No products yet. Use .addproduct to add some.' });
      return;
    }
    const list = products.map((p, i) =>
      `${i + 1}. *${p.name}* — ${settings.currency || 'USD'} ${parseFloat(p.price).toFixed(2)}\n   📂 ${p.category}${p.description ? '\n   ' + p.description : ''}`
    ).join('\n\n');
    await sock.sendMessage(jid, { text: `📦 *Your Catalogue (${products.length} items)*\n\n${list}` });
    return;
  }

  if (cmd === '.orders') {
    const orders = await db.getOrders(business.id, 'pending');
    if (!orders.length) {
      await sock.sendMessage(jid, { text: '📋 No pending orders.' });
      return;
    }
    const list = orders.map(o => {
      const items = o.items.map(i => `  • ${i.name} x${i.qty} @ ${settings.currency || 'USD'} ${i.price}`).join('\n');
      return `🧾 *${o.order_number}*\n👤 ${o.customer_name || o.customer_number}\n${items}\n💰 Total: ${settings.currency || 'USD'} ${parseFloat(o.total).toFixed(2)}\n🕐 ${new Date(o.created_at).toLocaleString()}`;
    }).join('\n\n─────────────\n');
    await sock.sendMessage(jid, { text: `📋 *Pending Orders (${orders.length})*\n\n${list}` });
    return;
  }

  if (cmd === '.allorders') {
    const orders = await db.getOrders(business.id);
    if (!orders.length) {
      await sock.sendMessage(jid, { text: '📋 No orders yet.' });
      return;
    }
    const statusEmoji = { pending: '⏳', confirmed: '✅', paid: '💰', preparing: '🍳', delivered: '🚚', cancelled: '❌' };
    const list = orders.map(o =>
      `${statusEmoji[o.status] || '•'} *${o.order_number}* — ${o.customer_name || o.customer_number}\n  ${settings.currency || 'USD'} ${parseFloat(o.total).toFixed(2)} | ${o.status.toUpperCase()}`
    ).join('\n');
    await sock.sendMessage(jid, { text: `📋 *All Orders (${orders.length})*\n\n${list}` });
    return;
  }

  if (cmd === '.update') {
    const orderNumber = args[1]?.toUpperCase();
    const newStatus = args[2]?.toLowerCase();
    const validStatuses = ['confirmed', 'paid', 'preparing', 'delivered', 'cancelled'];
    if (!orderNumber || !validStatuses.includes(newStatus)) {
      await sock.sendMessage(jid, {
        text: `❌ Usage: .update ORD-XXXXXX [status]\nValid: ${validStatuses.join(' / ')}`,
      });
      return;
    }
    const order = await db.updateOrderStatus(business.id, orderNumber, newStatus);
    if (!order) {
      await sock.sendMessage(jid, { text: `❌ Order ${orderNumber} not found.` });
      return;
    }
    await sock.sendMessage(jid, { text: `✅ Order *${orderNumber}* updated to *${newStatus.toUpperCase()}*` });
    const customerJid = formatNumber(order.customer_number);
    const msgs = {
      confirmed: `✅ Your order *${orderNumber}* has been confirmed!`,
      paid: `💰 Payment received for *${orderNumber}*. Thank you!`,
      preparing: `🍳 Your order *${orderNumber}* is being prepared!`,
      delivered: `🚚 Your order *${orderNumber}* has been delivered! Thank you for shopping with us. 🙏`,
      cancelled: `❌ Your order *${orderNumber}* has been cancelled. Please contact us for details.`,
    };
    if (msgs[newStatus]) {
      await delay(500, 1500);
      await sock.sendMessage(customerJid, { text: msgs[newStatus] });
    }
    return;
  }

  if (cmd === '.setshopname') {
    const name = args.slice(1).join(' ');
    if (!name) { await sock.sendMessage(jid, { text: '❌ Usage: .setshopname [Your Shop Name]' }); return; }
    await db.updateSetting(business.id, 'shop_name', name);
    await sock.sendMessage(jid, { text: `✅ Shop name set to: *${name}*` });
    return;
  }

  if (cmd === '.setwelcome') {
    const msg2 = args.slice(1).join(' ');
    if (!msg2) { await sock.sendMessage(jid, { text: '❌ Usage: .setwelcome [your welcome message]' }); return; }
    await db.updateSetting(business.id, 'welcome_message', msg2);
    await sock.sendMessage(jid, { text: `✅ Welcome message updated.` });
    return;
  }

  if (cmd === '.setpayment') {
    const details = args.slice(1).join(' ');
    if (!details) { await sock.sendMessage(jid, { text: '❌ Usage: .setpayment EcoCash: 077XXXXXXX | Mukuru: ...' }); return; }
    await db.updateSetting(business.id, 'payment_methods', details);
    await sock.sendMessage(jid, { text: `✅ Payment details updated.` });
    return;
  }

  if (cmd === '.setclosed') {
    if (args.length < 3) {
      await sock.sendMessage(jid, { text: '❌ Usage: .setclosed 22:00 08:00 _(start end in 24hr format)_' });
      return;
    }
    await db.updateSetting(business.id, 'closed_start', args[1]);
    await db.updateSetting(business.id, 'closed_end', args[2]);
    await sock.sendMessage(jid, { text: `✅ Closed hours set: *${args[1]}* to *${args[2]}*` });
    return;
  }

  if (cmd === '.setcurrency') {
    const cur = args[1]?.toUpperCase();
    if (!cur) { await sock.sendMessage(jid, { text: '❌ Usage: .setcurrency USD' }); return; }
    await db.updateSetting(business.id, 'currency', cur);
    await sock.sendMessage(jid, { text: `✅ Currency set to: *${cur}*` });
    return;
  }

  if (cmd === '.setaddress') {
    const address = args.slice(1).join(' ');
    if (!address) {
      await sock.sendMessage(jid, { text: '❌ Usage: .setaddress [your full shop address]\nExample: .setaddress 45 Samora Machel Ave, Harare CBD' });
      return;
    }
    await db.updateSetting(business.id, 'address', address);
    await sock.sendMessage(jid, { text: `✅ Business address set to:\n📍 ${address}` });
    return;
  }

  if (cmd === '.settings') {
    await sock.sendMessage(jid, {
      text: `⚙️ *Current Settings*\n\n` +
        `🏪 Shop Name: ${settings.shop_name}\n` +
        `📍 Address: ${settings.address || '_Not set — use .setaddress_'}\n` +
        `💬 Welcome: ${settings.welcome_message}\n` +
        `💳 Payment: ${settings.payment_methods}\n` +
        `🕐 Closed: ${settings.closed_start} – ${settings.closed_end}\n` +
        `💱 Currency: ${settings.currency}`,
    });
    return;
  }

  if (cmd === '.stats') {
    const orders = await db.getOrders(business.id);
    const revenue = orders.filter(o => o.status === 'paid' || o.status === 'delivered')
      .reduce((s, o) => s + parseFloat(o.total), 0);
    const pending = orders.filter(o => o.status === 'pending').length;
    await sock.sendMessage(jid, {
      text: `📊 *Shop Stats*\n\n` +
        `📋 Total Orders: ${orders.length}\n` +
        `⏳ Pending: ${pending}\n` +
        `💰 Revenue: ${settings.currency} ${revenue.toFixed(2)}`,
    });
    return;
  }

  if (cmd === '.subscription') {
    const days = daysLeft(business.expires_at);
    const planPrice = PLAN_PRICES[business.plan];
    await sock.sendMessage(jid, {
      text: `📅 *Subscription Status*\n\n` +
        `📦 Plan: *${business.plan.toUpperCase()}* ($${planPrice}/month)\n` +
        `✅ Status: ${business.status.toUpperCase()}\n` +
        `⏳ Days Remaining: *${days} days*\n` +
        `📆 Expires: ${new Date(business.expires_at).toDateString()}\n\n` +
        `To renew, contact your service provider.`,
    });
    return;
  }
}

async function handleCustomerMessage(sock, jid, senderNumber, text, msg, business, settings) {
  const lower = text.toLowerCase().trim();
  const currency = settings.currency || 'USD';

  const greetings = ['hi', 'hello', 'hey', 'hie', 'hola', 'good morning', 'good afternoon', 'good evening', 'sup', 'yo', 'menu'];
  if (greetings.some(g => lower === g || lower.startsWith(g + ' ')) || lower === '0') {
    await db.clearCart(business.id, senderNumber);
    await sock.sendMessage(jid, {
      text: `${settings.welcome_message || 'Welcome!'}\n\n` +
        `📌 *What would you like to do?*\n\n` +
        `1️⃣ Browse Catalogue\n` +
        `2️⃣ Place an Order\n` +
        `3️⃣ Track my Order\n` +
        `4️⃣ Payment Methods\n` +
        `5️⃣ Contact Us\n\n` +
        `_Reply with a number to continue_`,
    });
    return;
  }

  if (text === '1') {
    const products = await db.getProducts(business.id);
    if (!products.length) {
      await sock.sendMessage(jid, { text: '📦 Our catalogue is being updated. Check back soon!' });
      return;
    }

    const categories = [...new Set(products.map(p => p.category))];
    for (const category of categories) {
      const catProducts = products.filter(p => p.category === category);
      let catText = `📂 *${category}*\n\n`;
      for (const [i, product] of catProducts.entries()) {
        catText += `*${product.name}*\n`;
        catText += `💵 ${currency} ${parseFloat(product.price).toFixed(2)}\n`;
        if (product.description) catText += `📝 ${product.description}\n`;
        catText += '\n';

        if (product.image_data) {
          await delay(500, 1200);
          await sock.sendMessage(jid, {
            image: Buffer.from(product.image_data),
            caption: `*${product.name}*\n💵 ${currency} ${parseFloat(product.price).toFixed(2)}\n${product.description || ''}`,
          });
        }
      }
      if (!products.some(p => p.image_data)) {
        await sock.sendMessage(jid, { text: catText });
      }
    }

    await delay(500, 1000);
    await sock.sendMessage(jid, {
      text: `📋 To order any item, reply:\n*.order [product name]*\n\nExample: *.order Nike Air Max*\n\n_Reply *0* to return to menu_`,
    });
    return;
  }

  if (text === '2') {
    const products = await db.getProducts(business.id);
    if (!products.length) {
      await sock.sendMessage(jid, { text: '📦 No products available yet.' });
      return;
    }
    const list = products.map((p, i) =>
      `${i + 1}. *${p.name}* — ${currency} ${parseFloat(p.price).toFixed(2)}`
    ).join('\n');
    await sock.sendMessage(jid, {
      text: `📋 *Available Items*\n\n${list}\n\n_Reply: .order [product name] to add to cart_\n_Reply: .cart to view your cart_\n_Reply: .checkout to place your order_\n_Reply: 0 to go back_`,
    });
    return;
  }

  if (text === '3') {
    await sock.sendMessage(jid, {
      text: `🔍 *Track your order*\n\nReply with:\n*.track [order number]*\n\nExample: *.track ORD-123456*`,
    });
    return;
  }

  if (text === '4') {
    await sock.sendMessage(jid, {
      text: `💳 *Payment Methods*\n\n${settings.payment_methods || 'Contact us for payment details.'}\n\n_Reply *0* to return to menu_`,
    });
    return;
  }

  if (text === '5') {
    const addressLine = settings.address
      ? `📍 *Address:*\n${settings.address}\n\n`
      : '';
    await sock.sendMessage(jid, {
      text: `📞 *Contact Us*\n\n` +
        `🏪 ${settings.shop_name || 'Our Shop'}\n\n` +
        addressLine +
        `💬 For any questions or support, message us directly.\n\n` +
        `_Reply *0* to return to main menu_`,
    });
    return;
  }

  if (lower.startsWith('.order ')) {
    const productName = text.replace(/\.order /i, '').trim();
    const product = await db.getProductByName(business.id, productName);
    if (!product) {
      await sock.sendMessage(jid, {
        text: `❌ Product "*${productName}*" not found.\n\nReply *1* to browse our catalogue or *0* for main menu.`,
      });
      return;
    }

    const cart = await db.getCart(business.id, senderNumber);
    const existing = cart.find(i => i.id === product.id);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ id: product.id, name: product.name, price: parseFloat(product.price), qty: 1 });
    }
    await db.setCart(business.id, senderNumber, cart);

    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    await sock.sendMessage(jid, {
      text: `🛒 *${product.name}* added to cart!\n\n` +
        `Cart total: *${currency} ${total.toFixed(2)}*\n\n` +
        `• .cart — view cart\n• .checkout — place order\n• .order [item] — add more\n• 0 — main menu`,
    });
    return;
  }

  if (lower === '.cart') {
    const cart = await db.getCart(business.id, senderNumber);
    if (!cart.length) {
      await sock.sendMessage(jid, { text: '🛒 Your cart is empty.\n\nReply *1* to browse products.' });
      return;
    }
    const items = cart.map(i => `• *${i.name}* x${i.qty} — ${currency} ${(i.price * i.qty).toFixed(2)}`).join('\n');
    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    await sock.sendMessage(jid, {
      text: `🛒 *Your Cart*\n\n${items}\n\n💰 Total: *${currency} ${total.toFixed(2)}*\n\n• .checkout — confirm order\n• .clearcart — empty cart\n• 0 — main menu`,
    });
    return;
  }

  if (lower === '.clearcart') {
    await db.clearCart(business.id, senderNumber);
    await sock.sendMessage(jid, { text: '🗑️ Cart cleared.\n\nReply *1* to browse products.' });
    return;
  }

  if (lower.startsWith('.checkout')) {
    const cart = await db.getCart(business.id, senderNumber);
    if (!cart.length) {
      await sock.sendMessage(jid, { text: '🛒 Your cart is empty. Reply *1* to browse products.' });
      return;
    }
    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const notes = text.replace('.checkout', '').trim();
    const pushName = msg.pushName || senderNumber;
    const order = await db.createOrder(business.id, senderNumber, pushName, cart, total, notes);
    await db.clearCart(business.id, senderNumber);

    const itemsList = cart.map(i => `  • ${i.name} x${i.qty} @ ${currency} ${i.price.toFixed(2)}`).join('\n');
    const addressLine = settings.address ? `\n📍 *Pickup/Delivery Address:*\n${settings.address}\n` : '';
    await sock.sendMessage(jid, {
      text: `✅ *Order Placed!*\n\n` +
        `📋 Order #: *${order.order_number}*\n` +
        `👤 Name: ${pushName}\n` +
        `${itemsList}\n\n` +
        `💰 Total: *${currency} ${total.toFixed(2)}*\n\n` +
        `💳 *Payment:*\n${settings.payment_methods || 'Contact us for payment details.'}` +
        addressLine + `\n` +
        `_Your order will be confirmed once payment is received._\n_Track with: .track ${order.order_number}_`,
    });

    const ownerJid = formatNumber(business.wa_number);
    await delay(500, 1000);
    await sock.sendMessage(ownerJid, {
      text: `🔔 *New Order Received!*\n\n` +
        `📋 Order #: *${order.order_number}*\n` +
        `👤 Customer: ${pushName} (${senderNumber})\n` +
        `${itemsList}\n\n` +
        `💰 Total: *${currency} ${total.toFixed(2)}*\n\n` +
        `_Reply: .update ${order.order_number} confirmed_`,
    });
    return;
  }

  if (lower.startsWith('.track ')) {
    const orderNumber = text.replace(/\.track /i, '').trim().toUpperCase();
    const order = await db.trackOrder(business.id, orderNumber);
    if (!order) {
      await sock.sendMessage(jid, { text: `❌ Order *${orderNumber}* not found. Please check the order number.` });
      return;
    }
    const statusEmoji = { pending: '⏳', confirmed: '✅', paid: '💰', preparing: '🍳', delivered: '🚚', cancelled: '❌' };
    const emoji = statusEmoji[order.status] || '•';
    await sock.sendMessage(jid, {
      text: `🔍 *Order Tracking*\n\n` +
        `📋 Order #: *${order.order_number}*\n` +
        `${emoji} Status: *${order.status.toUpperCase()}*\n` +
        `💰 Total: ${currency} ${parseFloat(order.total).toFixed(2)}\n` +
        `📅 Placed: ${new Date(order.created_at).toLocaleString()}\n\n` +
        `_Reply *0* for main menu_`,
    });
    return;
  }
}

module.exports = { startBusinessBot };

