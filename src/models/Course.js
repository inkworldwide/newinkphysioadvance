const db = require('../db/connection');

function slugify(text) {
  return text.toString().toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const Course = {
  slugify,

  async findBySlug(slug) {
    return db.prepare(`
      SELECT c.*, cat.name as category_name, cat.slug as category_slug,
             u.name as instructor_name, u.avatar as instructor_avatar,
             u.headline as instructor_headline, u.bio as instructor_bio
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      JOIN users u ON c.instructor_id = u.id
      WHERE c.slug = ?
    `).get(slug);
  },

  async findById(id) {
    return db.prepare(`
      SELECT c.*, cat.name as category_name, cat.slug as category_slug,
             u.name as instructor_name, u.avatar as instructor_avatar,
             u.headline as instructor_headline, u.bio as instructor_bio
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      JOIN users u ON c.instructor_id = u.id
      WHERE c.id = ?
    `).get(id);
  },

  async allPublished({ category, search, level, sort } = {}) {
    let query = `
      SELECT c.*, cat.name as category_name, cat.slug as category_slug,
             u.name as instructor_name, u.avatar as instructor_avatar
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      JOIN users u ON c.instructor_id = u.id
      WHERE c.status = 'published'
    `;
    const params = [];
    if (category) { query += ` AND cat.slug = ?`; params.push(category); }
    if (level) { query += ` AND c.level = ?`; params.push(level); }
    if (search) { query += ` AND (c.title LIKE ? OR c.subtitle LIKE ? OR c.target_exam LIKE ?)`; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    if (sort === 'price_low') query += ` ORDER BY COALESCE(c.discount_price, c.price) ASC`;
    else if (sort === 'price_high') query += ` ORDER BY COALESCE(c.discount_price, c.price) DESC`;
    else if (sort === 'rating') query += ` ORDER BY c.rating_avg DESC`;
    else if (sort === 'popular') query += ` ORDER BY c.students_count DESC`;
    else query += ` ORDER BY c.created_at DESC`;

    return db.prepare(query).all(...params);
  },

  async featured(limit = 6) {
    return db.prepare(`
      SELECT c.*, cat.name as category_name, cat.slug as category_slug,
             u.name as instructor_name, u.avatar as instructor_avatar
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      JOIN users u ON c.instructor_id = u.id
      WHERE c.status = 'published' AND c.is_featured = 1
      ORDER BY c.rating_avg DESC LIMIT ?
    `).all(limit);
  },

  async byInstructor(instructorId) {
    return db.prepare(`
      SELECT c.*, cat.name as category_name
      FROM courses c LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE c.instructor_id = ? ORDER BY c.created_at DESC
    `).all(instructorId);
  },

  async all() {
    return db.prepare(`
      SELECT c.*, cat.name as category_name, u.name as instructor_name
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      JOIN users u ON c.instructor_id = u.id
      ORDER BY c.created_at DESC
    `).all();
  },

  async create(data) {
    // PhysioEdvance is a free platform — every course is published at no cost,
    // regardless of what an instructor enters in the form.
    data = { ...data, price: 0, discount_price: null };
    const slug = slugify(data.title) + '-' + Date.now().toString().slice(-5);
    const info = await db.prepare(`
      INSERT INTO courses (
        title, slug, subtitle, description, thumbnail, category_id, instructor_id,
        level, language, price, discount_price, duration_hours, target_exam, status,
        requirements, learning_outcomes
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) RETURNING id
    `).run(
      data.title, slug, data.subtitle, data.description, data.thumbnail, data.category_id,
      data.instructor_id, data.level, data.language, data.price, data.discount_price,
      data.duration_hours, data.target_exam, data.status, data.requirements, data.learning_outcomes
    );
    return this.findById(info.lastInsertRowid);
  },

  async update(id, data) {
    // Free platform: price changes from the instructor form are ignored.
    data = { ...data, price: 0, discount_price: null };
    await db.prepare(`
      UPDATE courses SET
        title=?, subtitle=?, description=?,
        category_id=?, level=?, language=?,
        price=?, discount_price=?, duration_hours=?,
        target_exam=?, status=?, requirements=?,
        learning_outcomes=?,
        thumbnail = COALESCE(?, thumbnail),
        updated_at = CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      data.title, data.subtitle, data.description, data.category_id, data.level, data.language,
      data.price, data.discount_price, data.duration_hours, data.target_exam, data.status,
      data.requirements, data.learning_outcomes, data.thumbnail, id
    );
    return this.findById(id);
  },

  async delete(id) {
    await db.prepare(`DELETE FROM courses WHERE id = ?`).run(id);
  },

  async setFeatured(id, isFeatured) {
    await db.prepare(`UPDATE courses SET is_featured = ? WHERE id = ?`).run(isFeatured ? 1 : 0, id);
  },

  async getModulesWithLessons(courseId) {
    const modules = await db.prepare(`SELECT * FROM modules WHERE course_id = ? ORDER BY position`).all(courseId);
    const lessonStmt = db.prepare(`SELECT * FROM lessons WHERE module_id = ? ORDER BY position`);
    const result = [];
    for (const m of modules) {
      const lessons = await lessonStmt.all(m.id);
      result.push({ ...m, lessons });
    }
    return result;
  },

  async totalLessonsCount(courseId) {
    const row = await db.prepare(`SELECT COUNT(*) as count FROM lessons WHERE course_id = ?`).get(courseId);
    return Number(row.count);
  },

  async getReviews(courseId) {
    return db.prepare(`
      SELECT r.*, u.name as user_name, u.avatar as user_avatar
      FROM reviews r JOIN users u ON r.user_id = u.id
      WHERE r.course_id = ? ORDER BY r.created_at DESC
    `).all(courseId);
  },

  async categories() {
    return db.prepare(`SELECT * FROM categories ORDER BY (year IS NULL), year, name`).all();
  },

  async ensureAllCategoriesExist() {
    const { YEAR_SUBJECTS, OTHER_SUBJECTS, slugify } = require('../config/subjectTaxonomy');
    for (const [year, subjects] of Object.entries(YEAR_SUBJECTS)) {
      for (const name of subjects) {
        const slug = slugify(name);
        const exists = await db.prepare("SELECT id FROM categories WHERE slug = ?").get(slug);
        if (!exists) {
          await db.prepare("INSERT INTO categories (name, slug, icon, description, year, is_other_subject) VALUES (?, ?, 'ri-pulse-line', ?, ?, 0)")
            .run(name, slug, `${name} — Year ${year} subject`, parseInt(year));
        }
      }
    }
    for (const name of OTHER_SUBJECTS) {
      const slug = slugify(name);
      const exists = await db.prepare("SELECT id FROM categories WHERE slug = ?").get(slug);
      if (!exists) {
        await db.prepare("INSERT INTO categories (name, slug, icon, description, year, is_other_subject) VALUES (?, ?, 'ri-stack-line', ?, NULL, 1)")
          .run(name, slug, `${name} — elective / cross-cutting subject`);
      }
    }
  },

  async countCoursesByCategory() {
    await this.ensureAllCategoriesExist();
    const rows = await db.prepare(`
      SELECT cat.id, cat.name, cat.slug, cat.icon, cat.year, cat.is_other_subject, COUNT(c.id) as course_count
      FROM categories cat
      LEFT JOIN courses c ON c.category_id = cat.id AND c.status = 'published'
      GROUP BY cat.id ORDER BY (cat.year IS NULL), cat.year, cat.name
    `).all();
    return rows.map(r => ({ ...r, course_count: Number(r.course_count) }));
  },

  async stats() {
    const totalCourses = (await db.prepare(`SELECT COUNT(*) as c FROM courses WHERE status='published'`).get()).c;
    const totalStudents = (await db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='student'`).get()).c;
    const totalInstructors = (await db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='instructor'`).get()).c;
    const totalEnrollments = (await db.prepare(`SELECT COUNT(*) as c FROM enrollments`).get()).c;
    return {
      totalCourses: Number(totalCourses),
      totalStudents: Number(totalStudents),
      totalInstructors: Number(totalInstructors),
      totalEnrollments: Number(totalEnrollments)
    };
  }
};

module.exports = Course;
