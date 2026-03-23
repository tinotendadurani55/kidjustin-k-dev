const postgres = require('postgres');

let sql;

async function initDB() {
    sql = postgres({
    host: process.env.DATABASE_HOST,     // ep-late-mode...
    database: process.env.DATABASE_NAME, // neondb
    user: process.env.DATABASE_USER,     // neondb_owner
    password: process.env.DATABASE_PASSWORD,
    port: 5432,                          // <--- KEEP THIS 5432
    ssl: 'require',
  });


  await sql`
    CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      owner_name VARCHAR(255) NOT NULL,
      wa_number VARCHAR(50) UNIQUE NOT NULL,
      plan VARCHAR(20) DEFAULT 'basic',
      status VARCHAR(20) DEFAULT 'pending',
      session_data TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP,
      last_payment TIMESTAMP,
      total_paid DECIMAL(10,2) DEFAULT 0
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS business_settings (
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE PRIMARY KEY,
      shop_name VARCHAR(255) DEFAULT 'My Shop',
      welcome_message TEXT DEFAULT 'Welcome! How can we help you today?',
      closed_start VARCHAR(10) DEFAULT '22:00',
      closed_end VARCHAR(10) DEFAULT '08:00',
      closed_message TEXT DEFAULT 'We are closed right now. We open at 8am.',
      payment_methods TEXT DEFAULT 'EcoCash | Contact owner for details',
      currency VARCHAR(10) DEFAULT 'USD',
      notify_number VARCHAR(50),
      timezone VARCHAR(50) DEFAULT 'Africa/Harare',
      address TEXT DEFAULT ''
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      description TEXT,
      category VARCHAR(100) DEFAULT 'General',
      image_data BYTEA,
      in_stock BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id),
      order_number VARCHAR(20) UNIQUE NOT NULL,
      customer_number VARCHAR(50) NOT NULL,
      customer_name VARCHAR(255),
      items JSONB NOT NULL,
      total DECIMAL(10,2) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS payment_logs (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id),
      owner_name VARCHAR(255),
      amount DECIMAL(10,2),
      plan VARCHAR(20),
      days_granted INTEGER,
      paid_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP,
      recorded_by VARCHAR(50)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS customer_carts (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id),
      customer_number VARCHAR(50),
      cart_data JSONB DEFAULT '[]',
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(business_id, customer_number)
    )
  `;

  await sql`ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS address TEXT DEFAULT ''`;

  console.log('[DB] All tables ready');
}

async function getBusiness(waNumber) {
  const rows = await sql`SELECT * FROM businesses WHERE wa_number = ${waNumber}`;
  return rows[0] || null;
}

async function getAllBusinesses() {
  return await sql`
    SELECT b.*, bs.shop_name
    FROM businesses b
    LEFT JOIN business_settings bs ON bs.business_id = b.id
    ORDER BY b.created_at DESC
  `;
}

async function createBusiness(waNumber, ownerName, plan) {
  const plans = { basic: 30, pro: 30, premium: 30 };
  const prices = { basic: 3, pro: 5, premium: 7 };
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + plans[plan]);

  const [biz] = await sql`
    INSERT INTO businesses (wa_number, owner_name, plan, status, expires_at)
    VALUES (${waNumber}, ${ownerName}, ${plan}, 'pending', ${expiresAt})
    ON CONFLICT (wa_number) DO UPDATE SET plan = ${plan}, status = 'pending'
    RETURNING *
  `;

  await sql`
    INSERT INTO business_settings (business_id, shop_name, notify_number)
    VALUES (${biz.id}, ${ownerName + "'s Shop"}, ${waNumber})
    ON CONFLICT (business_id) DO NOTHING
  `;

  return biz;
}

async function updateBusinessSession(waNumber, sessionData) {
  await sql`
    UPDATE businesses SET session_data = ${sessionData}, status = 'active'
    WHERE wa_number = ${waNumber}
  `;
}

async function updateBusinessStatus(waNumber, status) {
  await sql`UPDATE businesses SET status = ${status} WHERE wa_number = ${waNumber}`;
}

async function recordPayment(businessId, ownerName, amount, plan, daysGranted, expiresAt) {
  await sql`
    INSERT INTO payment_logs (business_id, owner_name, amount, plan, days_granted, expires_at)
    VALUES (${businessId}, ${ownerName}, ${amount}, ${plan}, ${daysGranted}, ${expiresAt})
  `;
  await sql`
    UPDATE businesses
    SET last_payment = NOW(), expires_at = ${expiresAt},
        total_paid = total_paid + ${amount}, status = 'active'
    WHERE id = ${businessId}
  `;
}

async function getSettings(businessId) {
  const rows = await sql`SELECT * FROM business_settings WHERE business_id = ${businessId}`;
  return rows[0] || {};
}

async function updateSetting(businessId, key, value) {
  await sql`
    UPDATE business_settings SET ${sql({ [key]: value })}
    WHERE business_id = ${businessId}
  `;
}

async function getProducts(businessId, category = null) {
  if (category) {
    return await sql`
      SELECT * FROM products
      WHERE business_id = ${businessId} AND category = ${category} AND in_stock = true
      ORDER BY name
    `;
  }
  return await sql`
    SELECT * FROM products
    WHERE business_id = ${businessId} AND in_stock = true
    ORDER BY category, name
  `;
}

async function addProduct(businessId, name, price, description, category, imageBuffer) {
  const [product] = await sql`
    INSERT INTO products (business_id, name, price, description, category, image_data)
    VALUES (${businessId}, ${name}, ${price}, ${description}, ${category || 'General'}, ${imageBuffer || null})
    RETURNING *
  `;
  return product;
}

async function removeProduct(businessId, name) {
  await sql`
    DELETE FROM products WHERE business_id = ${businessId} AND LOWER(name) = LOWER(${name})
  `;
}

async function getProductByName(businessId, name) {
  const rows = await sql`
    SELECT * FROM products
    WHERE business_id = ${businessId} AND LOWER(name) = LOWER(${name})
  `;
  return rows[0] || null;
}

async function createOrder(businessId, customerNumber, customerName, items, total, notes) {
  const orderNumber = 'ORD-' + Date.now().toString().slice(-6);
  const [order] = await sql`
    INSERT INTO orders (business_id, order_number, customer_number, customer_name, items, total, notes)
    VALUES (${businessId}, ${orderNumber}, ${customerNumber}, ${customerName}, ${JSON.stringify(items)}, ${total}, ${notes || ''})
    RETURNING *
  `;
  return order;
}

async function getOrders(businessId, status = null) {
  if (status) {
    return await sql`
      SELECT * FROM orders WHERE business_id = ${businessId} AND status = ${status}
      ORDER BY created_at DESC LIMIT 20
    `;
  }
  return await sql`
    SELECT * FROM orders WHERE business_id = ${businessId}
    ORDER BY created_at DESC LIMIT 20
  `;
}

async function updateOrderStatus(businessId, orderNumber, status) {
  const [order] = await sql`
    UPDATE orders SET status = ${status}, updated_at = NOW()
    WHERE business_id = ${businessId} AND order_number = ${orderNumber}
    RETURNING *
  `;
  return order;
}

async function trackOrder(businessId, orderNumber) {
  const rows = await sql`
    SELECT * FROM orders
    WHERE business_id = ${businessId} AND order_number = ${orderNumber}
  `;
  return rows[0] || null;
}

async function getCart(businessId, customerNumber) {
  const rows = await sql`
    SELECT * FROM customer_carts
    WHERE business_id = ${businessId} AND customer_number = ${customerNumber}
  `;
  return rows[0] ? rows[0].cart_data : [];
}

async function setCart(businessId, customerNumber, cartData) {
  await sql`
    INSERT INTO customer_carts (business_id, customer_number, cart_data, updated_at)
    VALUES (${businessId}, ${customerNumber}, ${JSON.stringify(cartData)}, NOW())
    ON CONFLICT (business_id, customer_number)
    DO UPDATE SET cart_data = ${JSON.stringify(cartData)}, updated_at = NOW()
  `;
}

async function clearCart(businessId, customerNumber) {
  await sql`
    DELETE FROM customer_carts WHERE business_id = ${businessId} AND customer_number = ${customerNumber}
  `;
}

async function getExpiringBusinesses(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  return await sql`
    SELECT b.*, bs.shop_name, bs.notify_number
    FROM businesses b
    LEFT JOIN business_settings bs ON bs.business_id = b.id
    WHERE b.status = 'active' AND b.expires_at <= ${cutoff} AND b.expires_at > NOW()
  `;
}

async function getExpiredBusinesses() {
  return await sql`
    SELECT * FROM businesses
    WHERE status = 'active' AND expires_at < NOW()
  `;
}

async function getRevenueStats() {
  const rows = await sql`
    SELECT
      COUNT(DISTINCT business_id) as total_clients,
      SUM(amount) as total_revenue,
      SUM(CASE WHEN paid_at >= NOW() - INTERVAL '30 days' THEN amount ELSE 0 END) as monthly_revenue
    FROM payment_logs
  `;
  return rows[0];
}

module.exports = {
  initDB,
  getBusiness,
  getAllBusinesses,
  createBusiness,
  updateBusinessSession,
  updateBusinessStatus,
  recordPayment,
  getSettings,
  updateSetting,
  getProducts,
  addProduct,
  removeProduct,
  getProductByName,
  createOrder,
  getOrders,
  updateOrderStatus,
  trackOrder,
  getCart,
  setCart,
  clearCart,
  getExpiringBusinesses,
  getExpiredBusinesses,
  getRevenueStats,
};

