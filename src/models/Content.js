const db = require('../db/connection');

// ============ NOTES ============
const Notes = {
  async byCategory(categoryId) {
    return db.prepare(`SELECT * FROM notes WHERE category_id = ? ORDER BY position, id`).all(categoryId);
  },
  async byYear(year) {
    return db.prepare(`
      SELECT n.*, c.name as subject_name, c.slug as subject_slug
      FROM notes n JOIN categories c ON n.category_id = c.id
      WHERE n.year = ? ORDER BY c.name, n.position
    `).all(year);
  },
  async findById(id) {
    return db.prepare(`SELECT n.*, c.name as subject_name FROM notes n JOIN categories c ON n.category_id = c.id WHERE n.id = ?`).get(id);
  },
  async create({ category_id, title, content, file_url, year, created_by }) {
    const posRow = await db.prepare(`SELECT COALESCE(MAX(position)+1,0) as p FROM notes WHERE category_id = ?`).get(category_id);
    const pos = posRow.p;
    const info = await db.prepare(`
      INSERT INTO notes (category_id, title, content, file_url, year, position, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).run(category_id, title, content, file_url || null, year, pos, created_by || null);
    return this.findById(info.lastInsertRowid);
  },
  async delete(id) {
    await db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
  }
};

// ============ TEAM MEMBERS ============
const Team = {
  async byGroup(group) {
    return db.prepare(`SELECT * FROM team_members WHERE group_name = ? AND is_active = 1 ORDER BY display_order, id`).all(group);
  },
  async featuredHomepage() {
    return db.prepare(`SELECT * FROM team_members WHERE is_active = 1 ORDER BY display_order ASC, id ASC LIMIT 4`).all();
  },
  async aboutStatements() {
    return db.prepare(`SELECT * FROM team_members WHERE show_on_about = 1 AND is_active = 1 ORDER BY display_order, id`).all();
  },
  async all() {
    return db.prepare(`SELECT * FROM team_members ORDER BY display_order ASC, id ASC`).all();
  },
  async findById(id) {
    return db.prepare(`SELECT * FROM team_members WHERE id = ?`).get(id);
  },
  async normalizePositions() {
    const members = await db.prepare(`SELECT id FROM team_members ORDER BY display_order ASC, id ASC`).all();
    for (let i = 0; i < members.length; i++) {
      await db.prepare(`UPDATE team_members SET display_order = ? WHERE id = ?`).run(i + 1, members[i].id);
    }
  },
  async normalizeAllGroupPositions() {
    await this.normalizePositions();
  },
  async create(data) {
    const groupName = data.group_name || 'founding';
    const targetOrder = Math.max(1, parseInt(data.display_order) || 1);
    
    await db.prepare(`UPDATE team_members SET display_order = display_order + 1 WHERE display_order >= ?`).run(targetOrder);

    const merged = { photo: '/images/team/default-avatar.png', display_order: targetOrder, show_on_about: 0, statement: '', ...data };
    const info = await db.prepare(`
      INSERT INTO team_members (name, role, designation, qualification, photo, bio, group_name, display_order, show_on_about, statement)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).run(merged.name, merged.role, merged.designation, merged.qualification, merged.photo, merged.bio, groupName, targetOrder, merged.show_on_about ? 1 : 0, merged.statement);

    await this.normalizePositions();
    return db.prepare(`SELECT * FROM team_members WHERE id = ?`).get(info.lastInsertRowid);
  },
  async toggleAboutShow(id) {
    const member = await this.findById(id);
    if (!member) return null;
    const newStatus = member.show_on_about ? 0 : 1;
    await db.prepare(`UPDATE team_members SET show_on_about = ? WHERE id = ?`).run(newStatus, id);
    return newStatus;
  },
  async update(id, data) {
    const existing = await this.findById(id);
    const targetGroup = data.group_name || (existing ? existing.group_name : 'founding');
    const targetOrder = Math.max(1, parseInt(data.display_order) || 1);

    if (existing && existing.display_order !== targetOrder) {
      await db.prepare(`UPDATE team_members SET display_order = display_order + 1 WHERE display_order >= ? AND id != ?`).run(targetOrder, id);
    }

    await db.prepare(`
      UPDATE team_members
      SET name = ?, role = ?, designation = ?, qualification = ?, photo = ?, bio = ?, group_name = ?, display_order = ?, show_on_about = ?, statement = ?
      WHERE id = ?
    `).run(
      data.name, data.role || '', data.designation || '', data.qualification || '',
      data.photo || '/images/team/default-avatar.png', data.bio || '',
      targetGroup, targetOrder,
      data.show_on_about ? 1 : 0, data.statement || '', id
    );

    await this.normalizePositions();
  },
  async delete(id) {
    await db.prepare(`DELETE FROM team_members WHERE id = ?`).run(id);
    await this.normalizePositions();
  },
  async moveUp(id) {
    const current = await this.findById(id);
    if (!current) return;
    const prev = await db.prepare(`SELECT * FROM team_members WHERE group_name = ? AND display_order <= ? AND id != ? ORDER BY display_order DESC, id DESC LIMIT 1`).get(current.group_name, current.display_order, current.id);
    if (prev) {
      const tempOrder = current.display_order;
      const targetOrder = prev.display_order === current.display_order ? Math.max(1, current.display_order - 1) : prev.display_order;
      await db.prepare(`UPDATE team_members SET display_order = ? WHERE id = ?`).run(targetOrder, current.id);
      await db.prepare(`UPDATE team_members SET display_order = ? WHERE id = ?`).run(tempOrder, prev.id);
    } else {
      await db.prepare(`UPDATE team_members SET display_order = ? WHERE id = ?`).run(Math.max(1, current.display_order - 1), current.id);
    }
    await this.normalizePositions(current.group_name);
  },
  async moveDown(id) {
    const current = await this.findById(id);
    if (!current) return;
    const next = await db.prepare(`SELECT * FROM team_members WHERE group_name = ? AND display_order >= ? AND id != ? ORDER BY display_order ASC, id ASC LIMIT 1`).get(current.group_name, current.display_order, current.id);
    if (next) {
      const tempOrder = current.display_order;
      const targetOrder = next.display_order === current.display_order ? current.display_order + 1 : next.display_order;
      await db.prepare(`UPDATE team_members SET display_order = ? WHERE id = ?`).run(targetOrder, current.id);
      await db.prepare(`UPDATE team_members SET display_order = ? WHERE id = ?`).run(tempOrder, next.id);
    } else {
      await db.prepare(`UPDATE team_members SET display_order = ? WHERE id = ?`).run(current.display_order + 1, current.id);
    }
    await this.normalizePositions(current.group_name);
  }
};

// ============ BLOG ============
const Blog = {
  async published({ type } = {}) {
    if (type) return db.prepare(`SELECT b.*, u.name as author_name FROM blog_posts b LEFT JOIN users u ON b.author_id = u.id WHERE b.status='published' AND b.post_type=? ORDER BY b.published_at DESC`).all(type);
    return db.prepare(`SELECT b.*, u.name as author_name FROM blog_posts b LEFT JOIN users u ON b.author_id = u.id WHERE b.status='published' ORDER BY b.published_at DESC`).all();
  },
  async findBySlug(slug) {
    return db.prepare(`SELECT b.*, u.name as author_name, u.avatar as author_avatar FROM blog_posts b LEFT JOIN users u ON b.author_id = u.id WHERE b.slug = ?`).get(slug);
  },
  async all() {
    return db.prepare(`SELECT b.*, u.name as author_name FROM blog_posts b LEFT JOIN users u ON b.author_id = u.id ORDER BY b.created_at DESC`).all();
  },
  async create(data) {
    const slug = data.title.toString().toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-') + '-' + Date.now().toString().slice(-5);
    const merged = {
      cover_image: '/images/blog/default-cover.jpg',
      published_at: data.status === 'published' ? new Date().toISOString() : null,
      ...data, slug
    };
    const info = await db.prepare(`
      INSERT INTO blog_posts (title, slug, excerpt, content, cover_image, post_type, author_id, status, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).run(merged.title, merged.slug, merged.excerpt, merged.content, merged.cover_image, merged.post_type, merged.author_id, merged.status, merged.published_at);
    return db.prepare(`SELECT * FROM blog_posts WHERE id = ?`).get(info.lastInsertRowid);
  },
  async delete(id) {
    await db.prepare(`DELETE FROM blog_posts WHERE id = ?`).run(id);
  }
};

// ============ LIVE SESSIONS ============
const LiveSessions = {
  async upcoming() {
    return db.prepare(`
      SELECT ls.*, u.name as host_name, c.name as subject_name,
        (SELECT COUNT(*) FROM live_session_registrations WHERE session_id = ls.id) as registered_count
      FROM live_sessions ls
      LEFT JOIN users u ON ls.host_id = u.id
      LEFT JOIN categories c ON ls.category_id = c.id
      WHERE ls.status = 'scheduled' AND ls.scheduled_at >= CURRENT_TIMESTAMP
      ORDER BY ls.scheduled_at ASC
    `).all();
  },
  async byType(type) {
    return db.prepare(`
      SELECT ls.*, u.name as host_name, c.name as subject_name
      FROM live_sessions ls
      LEFT JOIN users u ON ls.host_id = u.id
      LEFT JOIN categories c ON ls.category_id = c.id
      WHERE ls.session_type = ? ORDER BY ls.scheduled_at DESC
    `).all(type);
  },
  async findById(id) {
    return db.prepare(`
      SELECT ls.*, u.name as host_name, c.name as subject_name
      FROM live_sessions ls
      LEFT JOIN users u ON ls.host_id = u.id
      LEFT JOIN categories c ON ls.category_id = c.id
      WHERE ls.id = ?
    `).get(id);
  },
  async all() {
    return db.prepare(`SELECT ls.*, u.name as host_name FROM live_sessions ls LEFT JOIN users u ON ls.host_id = u.id ORDER BY ls.scheduled_at DESC`).all();
  },
  async create(data) {
    const merged = { status: 'scheduled', zoom_meeting_id: null, zoom_join_url: null, zoom_start_url: null, ...data };
    const info = await db.prepare(`
      INSERT INTO live_sessions (title, description, session_type, category_id, host_id, scheduled_at, duration_minutes, zoom_meeting_id, zoom_join_url, zoom_start_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).run(merged.title, merged.description, merged.session_type, merged.category_id, merged.host_id, merged.scheduled_at,
      merged.duration_minutes, merged.zoom_meeting_id, merged.zoom_join_url, merged.zoom_start_url, merged.status);
    return this.findById(info.lastInsertRowid);
  },
  async attachZoomMeeting(id, { zoomMeetingId, joinUrl, startUrl }) {
    await db.prepare(`UPDATE live_sessions SET zoom_meeting_id=?, zoom_join_url=?, zoom_start_url=? WHERE id=?`).run(zoomMeetingId, joinUrl, startUrl, id);
  },
  async delete(id) {
    await db.prepare(`DELETE FROM live_sessions WHERE id = ?`).run(id);
  },
  async register(sessionId, userId) {
    await db.prepare(`INSERT INTO live_session_registrations (session_id, user_id) VALUES (?, ?) ON CONFLICT (session_id, user_id) DO NOTHING`).run(sessionId, userId);
  },
  async isRegistered(sessionId, userId) {
    const row = await db.prepare(`SELECT 1 as x FROM live_session_registrations WHERE session_id=? AND user_id=?`).get(sessionId, userId);
    return !!row;
  },
  async registrants(sessionId) {
    return db.prepare(`
      SELECT r.*, u.name, u.email, u.phone FROM live_session_registrations r
      JOIN users u ON r.user_id = u.id WHERE r.session_id = ?
    `).all(sessionId);
  }
};

// ============ HERO FEATURES ============
const HeroFeature = {
  async allActive() {
    return db.prepare(`SELECT * FROM hero_features WHERE is_active = 1 ORDER BY display_order ASC, id ASC`).all();
  },
  async all() {
    return db.prepare(`SELECT * FROM hero_features ORDER BY display_order ASC, id ASC`).all();
  },
  async findById(id) {
    return db.prepare(`SELECT * FROM hero_features WHERE id = ?`).get(id);
  },
  async normalizePositions() {
    const items = await db.prepare(`SELECT id FROM hero_features ORDER BY display_order ASC, id ASC`).all();
    for (let i = 0; i < items.length; i++) {
      await db.prepare(`UPDATE hero_features SET display_order = ? WHERE id = ?`).run(i + 1, items[i].id);
    }
  },
  async create(data) {
    const targetOrder = Math.max(1, parseInt(data.display_order) || 1);
    await db.prepare(`UPDATE hero_features SET display_order = display_order + 1 WHERE display_order >= ?`).run(targetOrder);
    const info = await db.prepare(`
      INSERT INTO hero_features (title, subtitle, icon, url, badge_color, display_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).run(
      data.title, data.subtitle || '', data.icon || 'ri-star-line',
      data.url || '/courses', data.badge_color || 'warning',
      targetOrder, data.is_active === '0' || data.is_active === 0 ? 0 : 1
    );
    await this.normalizePositions();
    return db.prepare(`SELECT * FROM hero_features WHERE id = ?`).get(info.lastInsertRowid);
  },
  async update(id, data) {
    const existing = await this.findById(id);
    const targetOrder = Math.max(1, parseInt(data.display_order) || 1);
    if (existing && existing.display_order !== targetOrder) {
      await db.prepare(`UPDATE hero_features SET display_order = display_order + 1 WHERE display_order >= ? AND id != ?`).run(targetOrder, id);
    }
    await db.prepare(`
      UPDATE hero_features
      SET title = ?, subtitle = ?, icon = ?, url = ?, badge_color = ?, display_order = ?, is_active = ?
      WHERE id = ?
    `).run(
      data.title, data.subtitle || '', data.icon || 'ri-star-line',
      data.url || '/courses', data.badge_color || 'warning',
      targetOrder, data.is_active === '0' || data.is_active === 0 ? 0 : 1, id
    );
    await this.normalizePositions();
  },
  async delete(id) {
    await db.prepare(`DELETE FROM hero_features WHERE id = ?`).run(id);
    await this.normalizePositions();
  }
};

// ============ CLINICAL SPECIALTIES ============
const ClinicalSpecialty = {
  formatCard(row) {
    if (!row) return null;
    let itemsArr = [];
    if (typeof row.items === 'string') {
      itemsArr = row.items.split(/[\n,]+/).map(i => i.trim()).filter(Boolean);
    } else if (Array.isArray(row.items)) {
      itemsArr = row.items;
    }
    return {
      ...row,
      items: itemsArr,
      itemsRaw: row.items
    };
  },
  async allActive() {
    const rows = await db.prepare(`SELECT * FROM clinical_specialties WHERE is_active = 1 ORDER BY display_order ASC, id ASC`).all();
    return rows.map(r => this.formatCard(r));
  },
  async all() {
    const rows = await db.prepare(`SELECT * FROM clinical_specialties ORDER BY display_order ASC, id ASC`).all();
    return rows.map(r => this.formatCard(r));
  },
  async findById(id) {
    const row = await db.prepare(`SELECT * FROM clinical_specialties WHERE id = ?`).get(id);
    return this.formatCard(row);
  },
  async normalizePositions() {
    const items = await db.prepare(`SELECT id FROM clinical_specialties ORDER BY display_order ASC, id ASC`).all();
    for (let i = 0; i < items.length; i++) {
      await db.prepare(`UPDATE clinical_specialties SET display_order = ? WHERE id = ?`).run(i + 1, items[i].id);
    }
  },
  async create(data) {
    const slug = (data.slug || data.name).toString().toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
    const targetOrder = Math.max(1, parseInt(data.display_order) || 1);
    await db.prepare(`UPDATE clinical_specialties SET display_order = display_order + 1 WHERE display_order >= ?`).run(targetOrder);
    const info = await db.prepare(`
      INSERT INTO clinical_specialties (name, slug, icon, badge, theme, items, display_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).run(
      data.name, slug, data.icon || 'ri-stethoscope-fill',
      data.badge || 'Clinical', data.theme || 'primary',
      data.items || '', targetOrder, data.is_active === '0' || data.is_active === 0 ? 0 : 1
    );
    await this.normalizePositions();
    return this.findById(info.lastInsertRowid);
  },
  async update(id, data) {
    const existing = await this.findById(id);
    const targetOrder = Math.max(1, parseInt(data.display_order) || 1);
    const slug = (data.slug || data.name).toString().toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
    if (existing && existing.display_order !== targetOrder) {
      await db.prepare(`UPDATE clinical_specialties SET display_order = display_order + 1 WHERE display_order >= ? AND id != ?`).run(targetOrder, id);
    }
    await db.prepare(`
      UPDATE clinical_specialties
      SET name = ?, slug = ?, icon = ?, badge = ?, theme = ?, items = ?, display_order = ?, is_active = ?
      WHERE id = ?
    `).run(
      data.name, slug, data.icon || 'ri-stethoscope-fill',
      data.badge || 'Clinical', data.theme || 'primary',
      data.items || '', targetOrder, data.is_active === '0' || data.is_active === 0 ? 0 : 1, id
    );
    await this.normalizePositions();
  },
  async toggleActive(id) {
    const existing = await this.findById(id);
    if (!existing) return;
    const newStatus = existing.is_active ? 0 : 1;
    await db.prepare(`UPDATE clinical_specialties SET is_active = ? WHERE id = ?`).run(newStatus, id);
  },
  async delete(id) {
    await db.prepare(`DELETE FROM clinical_specialties WHERE id = ?`).run(id);
    await this.normalizePositions();
  }
};

module.exports = { Notes, Team, Blog, LiveSessions, HeroFeature, ClinicalSpecialty };
