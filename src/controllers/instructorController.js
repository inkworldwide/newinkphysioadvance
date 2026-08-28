const Course = require('../models/Course');
const Curriculum = require('../models/Curriculum');
const Quiz = require('../models/Quiz');
const Enrollment = require('../models/Enrollment');
const db = require('../db/connection');

exports.dashboard = async (req, res) => {
  const instructorId = req.session.user.id;
  const courses = await Course.byInstructor(instructorId);
  const totalStudents = Number((await db.prepare(`
    SELECT COUNT(DISTINCT e.user_id) as c FROM enrollments e
    JOIN courses c ON e.course_id = c.id WHERE c.instructor_id = ?
  `).get(instructorId)).c);
  const totalRevenue = Number((await db.prepare(`
    SELECT COALESCE(SUM(o.amount), 0) as total FROM orders o
    JOIN courses c ON o.course_id = c.id WHERE c.instructor_id = ? AND o.status = 'success'
  `).get(instructorId)).total);
  const avgRatingRow = await db.prepare(`
    SELECT AVG(rating_avg) as a FROM courses WHERE instructor_id = ? AND rating_count > 0
  `).get(instructorId);
  const avgRating = Number(avgRatingRow.a) || 0;
  const recentEnrollments = await Enrollment.recentForInstructor(instructorId, 8);

  res.render('instructor/dashboard', {
    title: 'Instructor Dashboard', layout: 'layouts/admin',
    courses, totalStudents, totalRevenue, avgRating: avgRating.toFixed(1), recentEnrollments
  });
};

exports.courseList = async (req, res) => {
  const courses = await Course.byInstructor(req.session.user.id);
  res.render('instructor/courses', { title: 'My Courses', layout: 'layouts/admin', courses });
};

exports.newCourseForm = async (req, res) => {
  const categories = await Course.categories();
  res.render('instructor/course-form', { title: 'Create Course', layout: 'layouts/admin', categories, course: null });
};

exports.createCourse = async (req, res) => {
  const data = req.body;
  const course = await Course.create({
    title: data.title, subtitle: data.subtitle, description: data.description,
    thumbnail: data.thumbnail || '/images/courses/default-course.jpg',
    category_id: data.category_id || null, instructor_id: req.session.user.id,
    level: data.level, language: data.language || 'English',
    price: parseFloat(data.price) || 0, discount_price: data.discount_price ? parseFloat(data.discount_price) : null,
    duration_hours: parseFloat(data.duration_hours) || 0, target_exam: data.target_exam,
    status: data.status || 'draft', requirements: data.requirements, learning_outcomes: data.learning_outcomes
  });
  req.flash('success', 'Course created! Now add modules and lessons.');
  res.redirect(`/instructor/courses/${course.id}/edit`);
};

exports.editCourseForm = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course || (course.instructor_id !== req.session.user.id && req.session.user.role !== 'admin')) {
    req.flash('error', 'Course not found or access denied.');
    return res.redirect('/instructor/courses');
  }
  const categories = await Course.categories();
  const modules = await Course.getModulesWithLessons(course.id);
  const quizzes = await Quiz.byCourse(course.id);
  res.render('instructor/course-form', { title: 'Edit Course', layout: 'layouts/admin', categories, course, modules, quizzes });
};

exports.updateCourse = async (req, res) => {
  const data = req.body;
  const course = await Course.findById(req.params.id);
  if (!course || (course.instructor_id !== req.session.user.id && req.session.user.role !== 'admin')) {
    req.flash('error', 'Access denied.');
    return res.redirect('/instructor/courses');
  }
  await Course.update(req.params.id, {
    title: data.title, subtitle: data.subtitle, description: data.description,
    category_id: data.category_id || null, level: data.level, language: data.language || 'English',
    price: parseFloat(data.price) || 0, discount_price: data.discount_price ? parseFloat(data.discount_price) : null,
    duration_hours: parseFloat(data.duration_hours) || 0, target_exam: data.target_exam,
    status: data.status, requirements: data.requirements, learning_outcomes: data.learning_outcomes,
    thumbnail: data.thumbnail || null
  });
  req.flash('success', 'Course updated successfully.');
  res.redirect(`/instructor/courses/${req.params.id}/edit`);
};

exports.deleteCourse = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course || (course.instructor_id !== req.session.user.id && req.session.user.role !== 'admin')) {
    req.flash('error', 'Access denied.');
    return res.redirect('/instructor/courses');
  }
  await Course.delete(req.params.id);
  req.flash('success', 'Course deleted.');
  res.redirect('/instructor/courses');
};

// ----- Modules & Lessons -----
exports.addModule = async (req, res) => {
  await Curriculum.addModule(req.params.courseId, req.body.title);
  req.flash('success', 'Module added.');
  res.redirect(`/instructor/courses/${req.params.courseId}/edit`);
};

exports.deleteModule = async (req, res) => {
  await Curriculum.deleteModule(req.params.moduleId);
  req.flash('success', 'Module removed.');
  res.redirect(`/instructor/courses/${req.params.courseId}/edit`);
};

exports.addLesson = async (req, res) => {
  const { title, type, video_url, content, duration_minutes, is_preview, quiz_id } = req.body;
  const uploadedVideoUrl = req.file ? `/uploads/lessons/${req.file.filename}` : null;
  await Curriculum.addLesson(req.params.moduleId, req.params.courseId, {
    title, type, video_url: uploadedVideoUrl || video_url, content, duration_minutes: parseInt(duration_minutes) || 10,
    is_preview: is_preview === 'on', quiz_id: quiz_id || null
  });
  req.flash('success', 'Lesson added.');
  res.redirect(`/instructor/courses/${req.params.courseId}/edit`);
};

exports.deleteLesson = async (req, res) => {
  await Curriculum.deleteLesson(req.params.lessonId);
  req.flash('success', 'Lesson removed.');
  res.redirect(`/instructor/courses/${req.params.courseId}/edit`);
};

// ----- Quizzes -----
exports.addQuiz = async (req, res) => {
  const { title, description, time_limit_minutes, pass_percentage } = req.body;
  await Quiz.create({ course_id: req.params.courseId, title, description, time_limit_minutes, pass_percentage });
  req.flash('success', 'Quiz created. Now add questions.');
  res.redirect(`/instructor/courses/${req.params.courseId}/edit`);
};

exports.quizDetail = async (req, res) => {
  const quiz = await Quiz.findById(req.params.quizId);
  const questions = await Quiz.getQuestions(req.params.quizId);
  const course = await Course.findById(req.params.courseId);
  res.render('instructor/quiz-detail', { title: 'Manage Quiz', layout: 'layouts/admin', quiz, questions, course });
};

exports.addQuestion = async (req, res) => {
  const { question, option_a, option_b, option_c, option_d, correct_option, explanation } = req.body;
  await Quiz.addQuestion(req.params.quizId, { question, option_a, option_b, option_c, option_d, correct_option, explanation });
  req.flash('success', 'Question added.');
  res.redirect(`/instructor/courses/${req.params.courseId}/quizzes/${req.params.quizId}`);
};

exports.deleteQuestion = async (req, res) => {
  await Quiz.deleteQuestion(req.params.questionId);
  req.flash('success', 'Question removed.');
  res.redirect(`/instructor/courses/${req.params.courseId}/quizzes/${req.params.quizId}`);
};

exports.deleteQuiz = async (req, res) => {
  await Quiz.delete(req.params.quizId);
  req.flash('success', 'Quiz deleted.');
  res.redirect(`/instructor/courses/${req.params.courseId}/edit`);
};

exports.students = async (req, res) => {
  const course = await Course.findById(req.params.id);
  const students = await Enrollment.studentsForCourse(req.params.id);
  res.render('instructor/students', { title: 'Enrolled Students', layout: 'layouts/admin', course, students });
};

exports.profile = (req, res) => {
  res.render('instructor/profile', { title: 'My Profile', layout: 'layouts/admin' });
};
