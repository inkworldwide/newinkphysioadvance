const db = require('../db/connection');

const Enrollment = {
  async isEnrolled(userId, courseId) {
    const row = await db.prepare(`SELECT 1 as x FROM enrollments WHERE user_id = ? AND course_id = ?`).get(userId, courseId);
    return !!row;
  },

  async find(userId, courseId) {
    return db.prepare(`SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?`).get(userId, courseId);
  },

  async enroll(userId, courseId) {
    await db.prepare(`INSERT INTO enrollments (user_id, course_id) VALUES (?, ?) ON CONFLICT (user_id, course_id) DO NOTHING`).run(userId, courseId);
    await db.prepare(`UPDATE courses SET students_count = students_count + 1 WHERE id = ?`).run(courseId);
    return this.find(userId, courseId);
  },

  async myCourses(userId) {
    const rows = await db.prepare(`
      SELECT e.*, c.title, c.slug, c.thumbnail, c.duration_hours, c.level, c.target_exam,
             u.name as instructor_name
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      JOIN users u ON c.instructor_id = u.id
      WHERE e.user_id = ?
      ORDER BY e.enrolled_at DESC
    `).all(userId);
    return rows.map(r => ({ ...r, progress_percent: Number(r.progress_percent) }));
  },

  async recalculateProgress(userId, courseId) {
    const totalRow = await db.prepare(`SELECT COUNT(*) as c FROM lessons WHERE course_id = ?`).get(courseId);
    const total = Number(totalRow.c);
    const doneRow = await db.prepare(`
      SELECT COUNT(*) as c FROM lesson_progress
      WHERE user_id = ? AND course_id = ? AND is_completed = 1
    `).get(userId, courseId);
    const done = Number(doneRow.c);
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    const status = percent >= 100 ? 'completed' : 'active';
    const completedAt = percent >= 100 ? new Date().toISOString() : null;
    await db.prepare(`
      UPDATE enrollments SET progress_percent = ?, status = ?, completed_at = COALESCE(?, completed_at)
      WHERE user_id = ? AND course_id = ?
    `).run(percent, status, completedAt, userId, courseId);
    return percent;
  },

  async markLessonComplete(userId, lessonId, courseId) {
    await db.prepare(`
      INSERT INTO lesson_progress (user_id, lesson_id, course_id, is_completed, completed_at)
      VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, lesson_id) DO UPDATE SET is_completed = 1, completed_at = CURRENT_TIMESTAMP
    `).run(userId, lessonId, courseId);
    return this.recalculateProgress(userId, courseId);
  },

  async getCompletedLessonIds(userId, courseId) {
    const rows = await db.prepare(`
      SELECT lesson_id FROM lesson_progress WHERE user_id = ? AND course_id = ? AND is_completed = 1
    `).all(userId, courseId);
    return rows.map(r => r.lesson_id);
  },

  async dashboardStats(userId) {
    const enrolled = Number((await db.prepare(`SELECT COUNT(*) as c FROM enrollments WHERE user_id = ?`).get(userId)).c);
    const completed = Number((await db.prepare(`SELECT COUNT(*) as c FROM enrollments WHERE user_id = ? AND status='completed'`).get(userId)).c);
    const certificates = Number((await db.prepare(`SELECT COUNT(*) as c FROM certificates WHERE user_id = ?`).get(userId)).c);
    const avgRow = await db.prepare(`SELECT AVG(progress_percent) as a FROM enrollments WHERE user_id = ?`).get(userId);
    const avgProgress = avgRow.a || 0;
    return { enrolled, completed, certificates, avgProgress: Math.round(Number(avgProgress)) };
  },

  async studentsForCourse(courseId) {
    const rows = await db.prepare(`
      SELECT e.*, u.name, u.email, u.avatar
      FROM enrollments e JOIN users u ON e.user_id = u.id
      WHERE e.course_id = ? ORDER BY e.enrolled_at DESC
    `).all(courseId);
    return rows.map(r => ({ ...r, progress_percent: Number(r.progress_percent) }));
  },

  async recentForInstructor(instructorId, limit = 10) {
    return db.prepare(`
      SELECT e.*, u.name as student_name, u.avatar as student_avatar, c.title as course_title
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      JOIN users u ON e.user_id = u.id
      WHERE c.instructor_id = ?
      ORDER BY e.enrolled_at DESC LIMIT ?
    `).all(instructorId, limit);
  }
};

module.exports = Enrollment;
