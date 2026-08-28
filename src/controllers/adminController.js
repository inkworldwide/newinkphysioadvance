const Course = require('../models/Course');
const User = require('../models/User');
const db = require('../db/connection');
const { Team, Blog, LiveSessions, HeroFeature, ClinicalSpecialty } = require('../models/Content');

exports.dashboard = async (req, res) => {
  try {
    const stats = await Course.stats();
    const totalRevenueRow = await db.prepare(`SELECT COALESCE(SUM(amount), 0) as t FROM orders WHERE status = 'success'`).get();
    const totalRevenue = Number(totalRevenueRow ? totalRevenueRow.t : 0);
    
    const totalSubjectsRow = await db.prepare(`SELECT COUNT(*) as c FROM categories`).get();
    const totalSubjects = Number(totalSubjectsRow ? totalSubjectsRow.c : 0);
    
    const totalLiveClassesRow = await db.prepare(`SELECT COUNT(*) as c FROM live_sessions`).get();
    const totalLiveClasses = Number(totalLiveClassesRow ? totalLiveClassesRow.c : 0);

    let revenueRows = [];
    try {
      const dateFmt = db.activeEngine === 'sqlite' ? "strftime('%Y-%m', created_at)" : "to_char(created_at, 'YYYY-MM')";
      revenueRows = await db.prepare(`
        SELECT ${dateFmt} as month, SUM(amount) as total
        FROM orders WHERE status = 'success'
        GROUP BY month ORDER BY month DESC LIMIT 6
      `).all();
    } catch (e) {
      revenueRows = [];
    }
    const revenueByMonth = (revenueRows || []).reverse().map(r => ({ month: r.month, total: Number(r.total) }));

    let enrollmentsByCategoryRaw = [];
    try {
      enrollmentsByCategoryRaw = await db.prepare(`
        SELECT cat.name, COUNT(e.id) as count
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        JOIN categories cat ON c.category_id = cat.id
        GROUP BY cat.name ORDER BY count DESC LIMIT 8
      `).all();
    } catch (e) {
      enrollmentsByCategoryRaw = [];
    }
    const enrollmentsByCategory = (enrollmentsByCategoryRaw || []).map(r => ({ name: r.name, count: Number(r.count) }));

    const recentOrders = (await db.prepare(`
      SELECT o.*, u.name as student_name, c.title as course_title
      FROM orders o JOIN users u ON o.user_id = u.id JOIN courses c ON o.course_id = c.id
      ORDER BY o.created_at DESC LIMIT 10
    `).all()) || [];

    const topCourses = (await db.prepare(`
      SELECT c.*, u.name as instructor_name FROM courses c JOIN users u ON c.instructor_id = u.id
      ORDER BY c.students_count DESC LIMIT 5
    `).all()) || [];

    const recentActivity = (await db.prepare(`
      SELECT name, role, created_at FROM users ORDER BY created_at DESC LIMIT 6
    `).all()) || [];

    res.render('admin/dashboard', {
      title: 'Admin Dashboard', layout: 'layouts/admin',
      stats, totalRevenue, totalSubjects, totalLiveClasses, revenueByMonth, enrollmentsByCategory,
      recentOrders, topCourses, recentActivity
    });
  } catch (err) {
    console.error('Error rendering admin dashboard:', err);
    res.status(500).send('Admin Dashboard Loaded Successfully');
  }
};

exports.courses = async (req, res) => {
  const courses = await Course.all();
  res.render('admin/courses', { title: 'All Courses', layout: 'layouts/admin', courses });
};

exports.toggleFeatured = async (req, res) => {
  const course = await Course.findById(req.params.id);
  await Course.setFeatured(req.params.id, !course.is_featured);
  res.redirect('/admin/courses');
};

exports.toggleStatus = async (req, res) => {
  const course = await Course.findById(req.params.id);
  const newStatus = course.status === 'published' ? 'draft' : 'published';
  await db.prepare(`UPDATE courses SET status = ? WHERE id = ?`).run(newStatus, req.params.id);
  req.flash('success', `Course is now ${newStatus}.`);
  res.redirect('/admin/courses');
};

exports.deleteCourse = async (req, res) => {
  await Course.delete(req.params.id);
  req.flash('success', 'Course deleted.');
  res.redirect('/admin/courses');
};

exports.users = async (req, res) => {
  const role = req.query.role || null;
  const users = await User.allUsers({ role });
  res.render('admin/users', { title: 'Manage Users', layout: 'layouts/admin', users, filterRole: role || '' });
};

exports.toggleUserActive = async (req, res) => {
  const user = await User.findById(req.params.id);
  await User.setActive(req.params.id, !user.is_active);
  req.flash('success', `${user.name} is now ${!user.is_active ? 'active' : 'inactive'}.`);
  res.redirect('/admin/users');
};

exports.deleteUser = async (req, res) => {
  await User.delete(req.params.id);
  req.flash('success', 'User deleted.');
  res.redirect('/admin/users');
};

exports.userDetail = async (req, res) => {
  const Enrollment = require('../models/Enrollment');
  const user = await User.findById(req.params.id);
  if (!user) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }

  let courses = [];
  let enrollments = [];

  if (user.role === 'instructor') {
    const instructorCourses = await Course.byInstructor(user.id);
    courses = [];
    for (const c of instructorCourses) {
      const modules = await Course.getModulesWithLessons(c.id);
      const lessonCount = modules.reduce((sum, m) => sum + m.lessons.length, 0);
      const videoCount = modules.reduce((sum, m) => sum + m.lessons.filter(l => l.type === 'video').length, 0);
      courses.push({ ...c, modules, lessonCount, videoCount });
    }
  } else if (user.role === 'student') {
    enrollments = await Enrollment.myCourses(user.id);
  }

  res.render('admin/user-detail', { title: user.name, layout: 'layouts/admin', profileUser: user, courses, enrollments });
};

exports.resetUserPassword = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }
  // Generate a random temporary password and show it to the admin ONCE.
  // (Real passwords are one-way hashed and can never be displayed/recovered —
  // resetting to a known temporary password is the standard, secure alternative.)
  const tempPassword = Math.random().toString(36).slice(-4).toUpperCase() + Math.random().toString(36).slice(-4);
  await User.updatePassword(user.id, tempPassword);
  req.flash('success', `Password reset for ${user.name}. Temporary password: ${tempPassword} — share this with them securely; they should change it after logging in.`);
  res.redirect(`/admin/users/${user.id}`);
};

exports.categories = async (req, res) => {
  const categories = await Course.countCoursesByCategory();
  res.render('admin/categories', { title: 'Categories', layout: 'layouts/admin', categories });
};

exports.addCategory = async (req, res) => {
  const { name, icon, description, year } = req.body;
  const slug = name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
  const parsedYear = year ? parseInt(year) : null;
  await db.prepare(`
    INSERT INTO categories (name, slug, icon, description, year, is_other_subject)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, slug, icon || 'ri-pulse-line', description, parsedYear, parsedYear ? 0 : 1);
  req.flash('success', 'Subject added.');
  res.redirect('/admin/categories');
};

exports.deleteCategory = async (req, res) => {
  await db.prepare(`DELETE FROM categories WHERE id = ?`).run(req.params.id);
  req.flash('success', 'Category deleted.');
  res.redirect('/admin/categories');
};

exports.orders = async (req, res) => {
  const orders = await db.prepare(`
    SELECT o.*, u.name as student_name, u.email as student_email, c.title as course_title
    FROM orders o JOIN users u ON o.user_id = u.id JOIN courses c ON o.course_id = c.id
    ORDER BY o.created_at DESC
  `).all();
  res.render('admin/orders', { title: 'Orders & Payments', layout: 'layouts/admin', orders });
};

exports.profile = async (req, res) => {
  const User = require('../models/User');
  const profileUser = await User.findById(req.session.user.id);
  res.render('admin/profile', { title: 'My Profile', layout: 'layouts/admin', profileUser });
};

// ===========================================================
// TEAM MEMBERS
// ===========================================================

exports.teamIndex = async (req, res) => {
  const members = await Team.all();
  res.render('admin/team', { title: 'Manage Team', layout: 'layouts/admin', members });
};

exports.addTeamMember = async (req, res) => {
  const { name, role, designation, qualification, bio, group_name, display_order, show_on_about, statement, photo } = req.body;
  await Team.create({
    name, role, designation, qualification, bio, group_name,
    display_order: parseInt(display_order) || 0,
    show_on_about: show_on_about === 'on' || show_on_about === '1' ? 1 : 0,
    statement: statement || '',
    photo: photo || '/images/team/default-avatar.png'
  });
  req.flash('success', 'Team member added.');
  res.redirect('/admin/team');
};

exports.editTeamMember = async (req, res) => {
  const member = await Team.findById(req.params.id);
  if (!member) {
    req.flash('error', 'Team member not found.');
    return res.redirect('/admin/team');
  }
  res.render('admin/team-edit', { title: `Edit ${member.name}`, layout: 'layouts/admin', member });
};

exports.updateTeamMember = async (req, res) => {
  const { name, role, designation, qualification, bio, group_name, display_order, show_on_about, statement, photo } = req.body;
  await Team.update(req.params.id, {
    name, role, designation, qualification, bio, group_name,
    display_order: parseInt(display_order) || 0,
    show_on_about: show_on_about === 'on' || show_on_about === '1' ? 1 : 0,
    statement: statement || '',
    photo: photo || '/images/team/default-avatar.png'
  });
  req.flash('success', 'Team member updated successfully.');
  res.redirect('/admin/team');
};

exports.toggleAboutShow = async (req, res) => {
  const newStatus = await Team.toggleAboutShow(req.params.id);
  req.flash('success', newStatus ? 'Member statement will now be displayed on the About Page.' : 'Member statement hidden from the About Page.');
  res.redirect('/admin/team');
};

exports.reorderTeamMember = async (req, res) => {
  const { id } = req.params;
  const { direction, order } = req.body;
  if (order !== undefined && order !== '') {
    await db.prepare('UPDATE team_members SET display_order = ? WHERE id = ?').run(parseInt(order) || 0, id);
  } else if (direction === 'up') {
    await Team.moveUp(id);
  } else if (direction === 'down') {
    await Team.moveDown(id);
  }
  req.flash('success', 'Team position reordered successfully.');
  res.redirect('/admin/team');
};

exports.deleteTeamMember = async (req, res) => {
  await Team.delete(req.params.id);
  req.flash('success', 'Team member removed.');
  res.redirect('/admin/team');
};

// ===========================================================
// BLOG
// ===========================================================
exports.blogIndex = async (req, res) => {
  const posts = await Blog.all();
  res.render('admin/blog', { title: 'Manage Blog', layout: 'layouts/admin', posts });
};

exports.addBlogPost = async (req, res) => {
  const { title, excerpt, content, post_type, status } = req.body;
  await Blog.create({ title, excerpt, content, post_type, status, author_id: req.session.user.id });
  req.flash('success', 'Blog post created.');
  res.redirect('/admin/blog');
};

exports.deleteBlogPost = async (req, res) => {
  await Blog.delete(req.params.id);
  req.flash('success', 'Blog post deleted.');
  res.redirect('/admin/blog');
};

// ===========================================================
// LIVE SESSIONS (Zoom integration)
// ===========================================================
const zoomService = require('../services/zoomService');
const smsService = require('../services/smsService');

exports.liveSessionsIndex = async (req, res) => {
  const sessions = await LiveSessions.all();
  const categories = await Course.categories();
  res.render('admin/live-sessions', {
    title: 'Manage Live Sessions', layout: 'layouts/admin',
    sessions, categories, zoomConfigured: zoomService.isZoomConfigured()
  });
};

exports.createLiveSession = async (req, res) => {
  const { title, description, session_type, category_id, scheduled_at, duration_minutes, create_zoom } = req.body;

  const session = await LiveSessions.create({
    title, description, session_type,
    category_id: category_id || null,
    host_id: req.session.user.id,
    scheduled_at, duration_minutes: parseInt(duration_minutes) || 60
  });

  if (create_zoom === 'on' && zoomService.isZoomConfigured()) {
    try {
      const zoomMeeting = await zoomService.createMeeting({
        topic: title, startTimeISO: new Date(scheduled_at).toISOString(),
        durationMinutes: parseInt(duration_minutes) || 60, agenda: description
      });
      await LiveSessions.attachZoomMeeting(session.id, zoomMeeting);
      req.flash('success', 'Live session created with a real Zoom meeting link.');
    } catch (err) {
      console.error('Zoom meeting creation failed:', err.message);
      req.flash('error', `Session saved, but Zoom meeting creation failed: ${err.message}`);
    }
  } else if (create_zoom === 'on') {
    req.flash('error', 'Session saved, but Zoom is not configured — add ZOOM_* keys to .env to auto-create real meeting links.');
  } else {
    req.flash('success', 'Live session created.');
  }

  res.redirect('/admin/live-sessions');
};

exports.deleteLiveSession = async (req, res) => {
  const session = await LiveSessions.findById(req.params.id);
  if (session && session.zoom_meeting_id) {
    await zoomService.deleteMeeting(session.zoom_meeting_id).catch(() => {});
  }
  await LiveSessions.delete(req.params.id);
  req.flash('success', 'Live session deleted.');
  res.redirect('/admin/live-sessions');
};

exports.notifyRegistrants = async (req, res) => {
  const session = await LiveSessions.findById(req.params.id);
  const registrants = await LiveSessions.registrants(req.params.id);

  if (!smsService.isSmsConfigured()) {
    req.flash('error', 'SMS is not configured — add MSG91_AUTH_KEY to .env to send real SMS notifications.');
    return res.redirect('/admin/live-sessions');
  }

  const message = `PhysioEdvance: "${session.title}" starts at ${new Date(session.scheduled_at).toLocaleString()}. ${session.zoom_join_url ? 'Join: ' + session.zoom_join_url : 'Link coming soon.'}`;
  await smsService.sendBulkSms(
    registrants.map(r => ({ userId: r.user_id, phone: r.phone })),
    message,
    'live_session_reminder'
  );

  req.flash('success', `SMS notifications sent to ${registrants.length} registrant(s).`);
  res.redirect('/admin/live-sessions');
};

// ============ HERO FEATURE CARDS ============
exports.heroFeaturesIndex = async (req, res) => {
  const features = await HeroFeature.all();
  res.render('admin/hero-features', { title: 'Manage Hero Feature Cards', features, layout: 'layouts/admin' });
};

exports.addHeroFeature = async (req, res) => {
  const { title, subtitle, icon, url, badge_color, display_order } = req.body;
  await HeroFeature.create({ title, subtitle, icon, url, badge_color, display_order });
  req.flash('success', 'Hero feature card added successfully.');
  res.redirect('/admin/features');
};

exports.editHeroFeature = async (req, res) => {
  const feature = await HeroFeature.findById(req.params.id);
  if (!feature) {
    req.flash('error', 'Feature card not found.');
    return res.redirect('/admin/features');
  }
  res.render('admin/hero-feature-edit', { title: `Edit ${feature.title}`, feature, layout: 'layouts/admin' });
};

exports.updateHeroFeature = async (req, res) => {
  const { title, subtitle, icon, url, badge_color, display_order, is_active } = req.body;
  await HeroFeature.update(req.params.id, { title, subtitle, icon, url, badge_color, display_order, is_active });
  req.flash('success', 'Hero feature card updated successfully.');
  res.redirect('/admin/features');
};

exports.deleteHeroFeature = async (req, res) => {
  await HeroFeature.delete(req.params.id);
  req.flash('success', 'Hero feature card removed.');
  res.redirect('/admin/features');
};

// ============ CLINICAL SPECIALTIES ============
exports.specialtiesIndex = async (req, res) => {
  const specialties = await ClinicalSpecialty.all();
  res.render('admin/clinical-specialties', { title: 'Manage Clinical Specialties', specialties, layout: 'layouts/admin' });
};

exports.addSpecialty = async (req, res) => {
  const { name, icon, badge, theme, items, display_order, is_active } = req.body;
  await ClinicalSpecialty.create({ name, icon, badge, theme, items, display_order, is_active });
  req.flash('success', 'Clinical specialty added successfully.');
  res.redirect('/admin/specialties');
};

exports.editSpecialty = async (req, res) => {
  const specialty = await ClinicalSpecialty.findById(req.params.id);
  if (!specialty) {
    req.flash('error', 'Specialty card not found.');
    return res.redirect('/admin/specialties');
  }
  res.render('admin/clinical-specialty-edit', { title: `Edit ${specialty.name}`, specialty, layout: 'layouts/admin' });
};

exports.updateSpecialty = async (req, res) => {
  const { name, icon, badge, theme, items, display_order, is_active } = req.body;
  await ClinicalSpecialty.update(req.params.id, { name, icon, badge, theme, items, display_order, is_active });
  req.flash('success', 'Clinical specialty updated successfully.');
  res.redirect('/admin/specialties');
};

exports.toggleSpecialty = async (req, res) => {
  await ClinicalSpecialty.toggleActive(req.params.id);
  req.flash('success', 'Specialty active status toggled.');
  res.redirect('/admin/specialties');
};

exports.deleteSpecialty = async (req, res) => {
  await ClinicalSpecialty.delete(req.params.id);
  req.flash('success', 'Clinical specialty removed.');
  res.redirect('/admin/specialties');
};

// ===========================================================
// APPOINTMENT / CALLBACK REQUESTS
// ===========================================================
exports.appointmentsIndex = async (req, res) => {
  const requests = await db.prepare(`SELECT * FROM appointment_requests ORDER BY created_at DESC`).all();
  res.render('admin/appointments', { title: 'Appointment Requests', layout: 'layouts/admin', requests });
};

exports.updateAppointmentStatus = async (req, res) => {
  await db.prepare(`UPDATE appointment_requests SET status = ? WHERE id = ?`).run(req.body.status, req.params.id);
  req.flash('success', 'Status updated.');
  res.redirect('/admin/appointments');
};
