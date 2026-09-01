const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const db = require('../db/connection');
const { Team, Blog, LiveSessions, HeroFeature, ClinicalSpecialty } = require('../models/Content');
const { PHYSIOTHERAPY_SPECIALTIES, THERAPY_TYPES, slugify } = require('../config/subjectTaxonomy');

exports.home = async (req, res) => {
  const featured = await Course.featured(6);
  const allCategories = await Course.countCoursesByCategory();
  const categoriesByYear = { 1: [], 2: [], 3: [], 4: [] };
  const otherSubjects = [];
  allCategories.forEach(cat => {
    if (cat.year) categoriesByYear[cat.year].push(cat);
    else otherSubjects.push(cat);
  });

  const stats = await Course.stats();
  const dbLessons = Number((await db.prepare(`SELECT COUNT(*) as c FROM lessons`).get()).c);
  const dbLive = Number((await db.prepare(`SELECT COUNT(*) as c FROM live_sessions`).get()).c);
  const dbCourses = Number((await db.prepare(`SELECT COUNT(*) as c FROM courses`).get()).c);

  stats.totalLessons = Math.max(120, dbLessons);
  stats.totalLiveSessions = Math.max(50, dbLive);
  stats.totalSeminars = Math.max(25, dbLive * 12);
  stats.totalWorkshops = Math.max(18, dbLive * 9);
  stats.totalFreeCourses = Math.max(30, dbCourses * 3);

  const founders = await Team.featuredHomepage();
  const heroFeatures = await HeroFeature.allActive();
  const specialties = await ClinicalSpecialty.allActive();
  const activeCourses = await Course.allPublished();

  res.render('public/home', {
    title: 'PhysioEdvance — One-Stop Solution for Physiotherapy Students',
    featured, categoriesByYear, otherSubjects, stats, founders, heroFeatures, activeCourses,
    specialties, therapyTypes: THERAPY_TYPES, slugify,
    bodyClass: 'landing-page'
  });
};

exports.courseList = async (req, res) => {
  const { category, search, level, sort } = req.query;
  const courses = await Course.allPublished({ category, search, level, sort });
  const categories = await Course.countCoursesByCategory();

  res.render('public/courses', {
    title: 'Explore Subjects & Courses',
    courses, categories,
    filters: { category: category || '', search: search || '', level: level || '', sort: sort || '' }
  });
};

exports.courseDetail = async (req, res) => {
  const course = await Course.findBySlug(req.params.slug);
  if (!course) {
    req.flash('error', 'Course not found.');
    return res.redirect('/subjects');
  }
  const modules = await Course.getModulesWithLessons(course.id);
  const totalLessons = await Course.totalLessonsCount(course.id);
  const reviews = await Course.getReviews(course.id);

  let isEnrolled = false;
  let enrollment = null;
  if (req.session.user) {
    enrollment = await Enrollment.find(req.session.user.id, course.id);
    isEnrolled = !!enrollment;
  }

  const related = await db.prepare(`
    SELECT c.*, u.name as instructor_name FROM courses c JOIN users u ON c.instructor_id = u.id
    WHERE c.category_id = ? AND c.id != ? AND c.status = 'published' LIMIT 4
  `).all(course.category_id, course.id);

  res.render('public/course-detail', {
    title: course.title,
    course, modules, totalLessons, reviews, isEnrolled, enrollment, related
  });
};

// ===== SUBJECTS (subdomain-ready: subjects.physioedvance.com per proposal) =====
exports.subjectsIndex = async (req, res) => {
  const allCategories = await Course.countCoursesByCategory();
  const categoriesByYear = { 1: [], 2: [], 3: [], 4: [] };
  const otherSubjects = [];
  allCategories.forEach(cat => {
    if (cat.year) categoriesByYear[cat.year].push(cat);
    else otherSubjects.push(cat);
  });
  res.render('public/subjects-index', { title: 'All Subjects', categoriesByYear, otherSubjects });
};

const subjectInteractiveData = require('../data/subjectInteractiveData');

exports.subjectDetail = async (req, res) => {
  const category = await db.prepare(`SELECT * FROM categories WHERE slug = ?`).get(req.params.slug);
  if (!category) {
    req.flash('error', 'Subject not found.');
    return res.redirect('/subjects');
  }
  const courses = await db.prepare(`
    SELECT c.*, u.name as instructor_name FROM courses c JOIN users u ON c.instructor_id = u.id
    WHERE c.category_id = ? AND c.status = 'published'
  `).all(category.id);

  const { Notes } = require('../models/Content');
  const notes = await Notes.byCategory(category.id);
  const research = await db.prepare(`SELECT * FROM research_articles WHERE category_id = ? ORDER BY created_at DESC`).all(category.id);

  // Load interactive subject hub data for Anatomy / Neurology or fallback
  const interactiveData = subjectInteractiveData[category.slug] || subjectInteractiveData['anatomy'];

  res.render('public/subject-detail', { title: category.name, category, courses, notes, research, interactiveData });
};

exports.subjectSectionDetail = async (req, res) => {
  const category = await db.prepare(`SELECT * FROM categories WHERE slug = ?`).get(req.params.slug);
  if (!category) {
    req.flash('error', 'Subject not found.');
    return res.redirect('/subjects');
  }
  const interactiveData = subjectInteractiveData[category.slug] || subjectInteractiveData['anatomy'];
  const activeSection = req.params.section || 'syllabus';

  res.render('public/subject-section', {
    title: `${category.name} - ${activeSection.replace('-', ' ').toUpperCase()}`,
    category,
    interactiveData,
    activeSection
  });
};

exports.about = async (req, res) => {
  const aboutStatements = await Team.aboutStatements();
  console.log(`[About Controller] Rendering /about with ${aboutStatements.length} leadership statements`);
  res.render('public/about', { title: 'About Us', aboutStatements });
};

exports.theTeam = async (req, res) => {
  const teachingStaff = await db.prepare(`SELECT * FROM team_members WHERE (group_name = 'teaching_staff' OR group_name = 'teaching') AND is_active = 1 ORDER BY display_order, id`).all();
  const nonTeachingStaff = await Team.byGroup('non_teaching_staff');
  const subjectExperts = await Team.byGroup('subject_experts');
  const technicalAssistance = await Team.byGroup('technical_assistance');
  const otherStaff = await Team.byGroup('other_staff');
  const founding = await Team.byGroup('founding');
  const advisory = await Team.byGroup('advisory');
  const legalBusiness = await Team.byGroup('legal_business');

  res.render('public/the-team', {
    title: 'The Team',
    teachingStaff,
    nonTeachingStaff,
    subjectExperts,
    technicalAssistance,
    otherStaff,
    founding,
    advisory,
    legalBusiness
  });
};

exports.blogIndex = async (req, res) => {
  const type = req.query.type;
  const posts = await Blog.published({ type });
  res.render('public/blog', { title: 'Blog', posts, filterType: type || '' });
};

exports.blogDetail = async (req, res) => {
  const post = await Blog.findBySlug(req.params.slug);
  if (!post) {
    req.flash('error', 'Post not found.');
    return res.redirect('/blog');
  }
  res.render('public/blog-detail', { title: post.title, post });
};

exports.liveSessions = async (req, res) => {
  const upcoming = await LiveSessions.upcoming();
  res.render('public/live-sessions', { title: 'Live Classes & Workshops', upcoming });
};

exports.registerForSession = async (req, res) => {
  if (!req.session.user) {
    req.flash('error', 'Please log in to register for live sessions.');
    return res.redirect('/auth/login');
  }
  await LiveSessions.register(req.params.id, req.session.user.id);
  req.flash('success', 'You are registered! Join link will be shared closer to the session.');
  res.redirect('/live-sessions');
};

exports.contact = (req, res) => {
  res.render('public/contact', { title: 'Contact Us' });
};

exports.submitContact = (req, res) => {
  req.flash('success', "Thanks for reaching out! Our team will get back to you within 24 hours.");
  res.redirect('/contact');
};

exports.submitAppointment = async (req, res) => {
  const { name, phone, email, preferred_date, message, request_type, service_type, academic_year } = req.body;
  let fullMessage = message || '';
  const metaNotes = [];
  if (service_type) metaNotes.push(`Service: ${service_type}`);
  if (academic_year) metaNotes.push(`Year/Subject: ${academic_year}`);
  if (metaNotes.length > 0) {
    fullMessage = `[${metaNotes.join(' | ')}] ${fullMessage}`.trim();
  }

  await db.prepare(`
    INSERT INTO appointment_requests (name, phone, email, preferred_date, message, request_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, phone, email || null, preferred_date || null, fullMessage || null, request_type || 'appointment');
  req.flash('success', "Thanks! We've received your request and will contact you shortly.");
  res.redirect('/');
};

exports.instructorProfile = async (req, res) => {
  const instructor = await db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'instructor'`).get(req.params.id);
  if (!instructor) {
    req.flash('error', 'Instructor not found.');
    return res.redirect('/subjects');
  }
  const allCourses = await Course.byInstructor(instructor.id);
  const courses = allCourses.filter(c => c.status === 'published');
  res.render('public/instructor-profile', { title: instructor.name, instructor, courses });
};
