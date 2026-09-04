const fs = require('fs');
const path = require('path');
const db = require('./connection');

let isMigrating = false;

async function migrate() {
  if (isMigrating) return;
  isMigrating = true;
  try {
    try {
      await db.query('SELECT 1');
    } catch (e) {}

    const isSqlite = db.activeEngine === 'sqlite';
    const schemaFile = isSqlite ? 'schema.sqlite.sql' : 'schema.pg.sql';
    const schemaPath = path.join(__dirname, schemaFile);
    let schema = fs.readFileSync(schemaPath, 'utf8');
    await db.exec(schema);
    console.log(`✅ Database schema (${schemaFile}) applied successfully.`);

    if (isSqlite) {
      try {
        const teamCols = await db.prepare("PRAGMA table_info(team_members)").all();
        const colNames = (teamCols || []).map(c => c.name);
        if (colNames.length > 0 && !colNames.includes('group_name')) {
          await db.exec("ALTER TABLE team_members ADD COLUMN group_name TEXT DEFAULT 'core';");
        }
        if (colNames.length > 0 && !colNames.includes('designation')) {
          await db.exec("ALTER TABLE team_members ADD COLUMN designation TEXT;");
        }
        if (colNames.length > 0 && !colNames.includes('photo')) {
          await db.exec("ALTER TABLE team_members ADD COLUMN photo TEXT DEFAULT '/images/team/default-avatar.png';");
        }
        if (colNames.length > 0 && !colNames.includes('display_order')) {
          await db.exec("ALTER TABLE team_members ADD COLUMN display_order INTEGER DEFAULT 0;");
        }
        if (colNames.length > 0 && !colNames.includes('show_on_about')) {
          await db.exec("ALTER TABLE team_members ADD COLUMN show_on_about INTEGER DEFAULT 0;");
        }
        if (colNames.length > 0 && !colNames.includes('statement')) {
          await db.exec("ALTER TABLE team_members ADD COLUMN statement TEXT;");
        }
      } catch (e) {}

      try {
        const sessCols = await db.prepare("PRAGMA table_info(live_sessions)").all();
        const sColNames = (sessCols || []).map(c => c.name);
        if (sColNames.length > 0 && !sColNames.includes('session_type')) {
          await db.exec("ALTER TABLE live_sessions ADD COLUMN session_type TEXT DEFAULT 'live_class';");
        }
        if (sColNames.length > 0 && !sColNames.includes('category_id')) {
          await db.exec("ALTER TABLE live_sessions ADD COLUMN category_id INTEGER;");
        }
        if (sColNames.length > 0 && !sColNames.includes('zoom_join_url')) {
          await db.exec("ALTER TABLE live_sessions ADD COLUMN zoom_join_url TEXT;");
        }
        if (sColNames.length > 0 && !sColNames.includes('zoom_start_url')) {
          await db.exec("ALTER TABLE live_sessions ADD COLUMN zoom_start_url TEXT;");
        }
        if (sColNames.length > 0 && !sColNames.includes('status')) {
          await db.exec("ALTER TABLE live_sessions ADD COLUMN status TEXT DEFAULT 'scheduled';");
        }
      } catch (e) {}
    }

    const userCount = await db.prepare('SELECT COUNT(*) as cnt FROM users').get();
    const count = parseInt((userCount && (userCount.cnt || userCount.count)) || 0, 10);
    if (count === 0) {
      console.log('🌱 Database is empty. Seeding initial data...');
      try {
        const seedFn = require('./seed');
        if (typeof seedFn === 'function') {
          await seedFn();
        }
      } catch (seedErr) {
        console.error('Seeding notice (non-fatal):', seedErr.message || seedErr);
      }
    }

    // Seed/Ensure Hero Features table
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS hero_features (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          subtitle TEXT NOT NULL,
          icon TEXT DEFAULT 'ri-star-line',
          url TEXT DEFAULT '/courses',
          badge_color TEXT DEFAULT 'warning',
          display_order INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      const hCount = Number((await db.prepare('SELECT COUNT(*) as c FROM hero_features').get()).c);
      if (hCount === 0) {
        const defaults = [
          { title: 'Seminars', subtitle: '25+ Webinars & Research', icon: 'ri-slideshow-3-line', url: '/live-sessions', badge_color: 'warning', display_order: 1 },
          { title: 'Recorded Videos', subtitle: '120+ HD Video Lectures', icon: 'ri-video-download-line', url: '/courses', badge_color: 'info', display_order: 2 },
          { title: 'Students', subtitle: '500+ Active Students', icon: 'ri-graduation-cap-line', url: '/auth/register', badge_color: 'purple', display_order: 3 },
          { title: 'Workshops', subtitle: '18+ Practical Workshops', icon: 'ri-tools-line', url: '/live-sessions', badge_color: 'success', display_order: 4 },
          { title: 'Live Classes', subtitle: '50+ Live Classes Done', icon: 'ri-live-line', url: '/live-sessions', badge_color: 'danger', display_order: 5 },
          { title: 'Free Courses', subtitle: '30+ BPT Study Modules', icon: 'ri-gift-line', url: '/subjects', badge_color: 'primary', display_order: 6 }
        ];
        for (const d of defaults) {
          await db.prepare(`
            INSERT INTO hero_features (title, subtitle, icon, url, badge_color, display_order)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(d.title, d.subtitle, d.icon, d.url, d.badge_color, d.display_order);
        }
        console.log('✨ Default 5 Hero Feature cards seeded.');
      }
    } catch (e) {
      console.warn('Hero features seed notice:', e.message);
    }

    // Seed/Ensure Clinical Specialties table
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS clinical_specialties (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          icon TEXT DEFAULT 'ri-stethoscope-fill',
          badge TEXT DEFAULT 'Clinical',
          theme TEXT DEFAULT 'primary',
          items TEXT NOT NULL,
          display_order INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      const sCount = Number((await db.prepare('SELECT COUNT(*) as c FROM clinical_specialties').get()).c);
      if (sCount === 0) {
        const defaults = [
          { name: 'Post-Surgery Physiotherapy', slug: 'post-surgery-physiotherapy', icon: 'ri-hospital-fill', badge: 'Surgical Rehab', theme: 'primary', items: 'Total Knee / Hip Replacement\nShoulder / Hip / Knee Surgeries\nAnkle / Elbow Fractures\nCervical / Spine Surgery', display_order: 1 },
          { name: 'Geriatric & Elderly Care', slug: 'geriatric-elderly-care', icon: 'ri-user-heart-fill', badge: 'Senior Wellness', theme: 'success', items: 'Arthritis & Joint Care\nBack & Muscular Pain\nGait & Balance Disorders\nUrinary Incontinence Care', display_order: 2 },
          { name: 'Chronic Pain Management', slug: 'chronic-pain-management', icon: 'ri-health-book-fill', badge: 'Pain Relief', theme: 'warning', items: 'Degenerative Disc & Sciatic Pain\nNeck & Shoulder Stiffness\nMigraines & Tension Headaches\nCervical Spondylosis', display_order: 3 },
          { name: 'Orthopedic & Sports Injuries', slug: 'orthopedic-sports-injuries', icon: 'ri-body-scan-fill', badge: 'Sports Science', theme: 'danger', items: 'Sprains, Strains & Ligament Tears\nBack, Neck & Joint Pain\nMuscle Imbalance & Performance\nPost-Traumatic Rehabilitation', display_order: 4 },
          { name: 'Pediatric Physiotherapy', slug: 'pediatric-physiotherapy', icon: 'ri-bear-smile-fill', badge: 'Child Care', theme: 'info', items: 'Cerebral Palsy Therapy\nDevelopmental Delay Rehab\nSpina Bifida & Torticollis\nPediatric Respiratory Rehab', display_order: 5 },
          { name: 'Specialty & Neurological Care', slug: 'specialty-neurological-care', icon: 'ri-mental-health-fill', badge: 'Specialized Clinical', theme: 'purple', items: 'Post-Stroke Neuro Rehab\nNeurological Disorder Management\nMusculoskeletal Strengthening\nWomen\'s Health Physiotherapy', display_order: 6 }
        ];
        for (const d of defaults) {
          await db.prepare(`
            INSERT INTO clinical_specialties (name, slug, icon, badge, theme, items, display_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(d.name, d.slug, d.icon, d.badge, d.theme, d.items, d.display_order);
        }
        console.log('🩺 Default 6 Clinical Specialty cards seeded.');
      }
    } catch (e) {
      console.warn('Clinical specialties seed notice:', e.message);
    }

    // Always ensure ink@physioadvance.com Superadmin user exists with password ink@123
    try {
      const bcrypt = require('bcryptjs');
      const inkHash = bcrypt.hashSync('ink@123', 8);
      const inkUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = 'ink@physioadvance.com' OR LOWER(email) = 'admin@physioedvance.com' OR id = 1").get();
      if (inkUser) {
        await db.prepare("UPDATE users SET email = $1, password = $2, role = 'admin', is_active = 1 WHERE id = $3").run(['ink@physioadvance.com', inkHash, inkUser.id]);
        console.log('👑 Superadmin synced: ink@physioadvance.com / ink@123');
      } else {
        await db.prepare("INSERT INTO users (name, email, password, role, is_active, email_verified) VALUES ('Super Admin', 'ink@physioadvance.com', $1, 'admin', 1, 1)").run([inkHash]);
        console.log('👑 Superadmin created: ink@physioadvance.com / ink@123');
      }
    } catch (e) {
      console.warn('Superadmin sync notice:', e.message);
    }
  } finally {
    isMigrating = false;
  }
}

module.exports = migrate;
