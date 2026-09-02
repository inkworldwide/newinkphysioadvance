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
  res.redirect('/instructor/courses/wizard');
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

exports.courseWizardView = async (req, res) => {
  const categories = await Course.categories();
  let course = null;
  let modules = [];
  let quizzes = [];
  if (req.query.courseId) {
    course = await Course.findById(req.query.courseId);
    if (course) {
      modules = await Course.getModulesWithLessons(course.id);
      quizzes = await Quiz.byCourse(course.id);
    }
  }
  res.render('instructor/course-wizard', {
    title: course ? 'Edit Course Wizard' : 'Create Course Wizard',
    layout: 'layouts/admin',
    categories,
    course,
    modules,
    quizzes,
    step: parseInt(req.query.step || 1, 10)
  });
};

exports.saveCourseWizard = async (req, res) => {
  try {
    const data = req.body;
    let courseId = data.course_id;

    // Map uploaded files by fieldname
    const uploadedFiles = {};
    if (req.files && Array.isArray(req.files)) {
      req.files.forEach(f => {
        uploadedFiles[f.fieldname] = f.filename;
      });
    }

    let thumbnail = data.thumbnail || '/images/courses/course-placeholder.jpg';
    if (uploadedFiles['thumbnail_file']) {
      thumbnail = `/uploads/courses/${uploadedFiles['thumbnail_file']}`;
    }

    if (!courseId) {
      const slug = slugify(data.title || 'course') + '-' + Date.now().toString().slice(-4);
      const info = await db.prepare(`
        INSERT INTO courses (instructor_id, category_id, title, slug, subtitle, description, level, duration_hours, target_exam, status, learning_outcomes, requirements, thumbnail, price, language)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'English') RETURNING id
      `).run(
        req.session.user.id,
        data.category_id || 1,
        data.title || 'Untitled Course',
        slug,
        data.subtitle || '',
        data.description || '',
        data.level || 'Beginner',
        parseFloat(data.duration_hours) || 12,
        data.target_exam || 'BPT 1st Year',
        data.is_publish === '1' ? 'published' : 'draft',
        data.learning_outcomes || '',
        data.requirements || '',
        thumbnail
      );
      courseId = info.lastInsertRowid;
    } else {
      const existing = await Course.findById(courseId);
      if (existing) {
        let finalThumbnail = existing.thumbnail || '/images/courses/course-placeholder.jpg';
        if (uploadedFiles['thumbnail_file']) {
          finalThumbnail = `/uploads/courses/${uploadedFiles['thumbnail_file']}`;
        } else if (data.thumbnail) {
          finalThumbnail = data.thumbnail;
        }

        await db.prepare(`
          UPDATE courses
          SET title = ?, subtitle = ?, description = ?, category_id = ?, level = ?, duration_hours = ?, target_exam = ?, status = ?, requirements = ?, learning_outcomes = ?, thumbnail = ?
          WHERE id = ?
        `).run(
          data.title || existing.title,
          data.subtitle !== undefined ? data.subtitle : existing.subtitle,
          data.description !== undefined ? data.description : existing.description,
          data.category_id || existing.category_id,
          data.level || existing.level,
          parseFloat(data.duration_hours) || existing.duration_hours || 12,
          data.target_exam || existing.target_exam,
          data.is_publish === '1' ? 'published' : (data.is_publish === '0' ? 'draft' : existing.status),
          data.requirements !== undefined ? data.requirements : existing.requirements,
          data.learning_outcomes !== undefined ? data.learning_outcomes : existing.learning_outcomes,
          finalThumbnail,
          courseId
        );
      }
    }

    // Determine target module ID (existing module OR newly created module)
    let targetModuleId = data.existing_module_id ? parseInt(data.existing_module_id, 10) : null;
    if (data.module_title) {
      const moduleCount = (await db.prepare(`SELECT COUNT(*) as cnt FROM modules WHERE course_id = ?`).get(courseId))?.cnt || 0;
      targetModuleId = await Course.addModule(courseId, {
        title: data.module_title,
        description: data.module_description || '',
        sort_order: moduleCount + 1
      });
    }

    // Process multiple lessons under the target module
    if (targetModuleId) {
      const lessonTitles = Array.isArray(data.lesson_title) ? data.lesson_title : (data.lesson_title ? [data.lesson_title] : []);
      const lessonDurations = Array.isArray(data.duration_minutes) ? data.duration_minutes : (data.duration_minutes ? [data.duration_minutes] : []);
      const lessonUrls = Array.isArray(data.video_url) ? data.video_url : (data.video_url ? [data.video_url] : []);
      const lessonNotes = Array.isArray(data.lesson_notes) ? data.lesson_notes : (data.lesson_notes ? [data.lesson_notes] : []);

      for (let i = 0; i < lessonTitles.length; i++) {
        const title = lessonTitles[i];
        if (!title || !title.trim()) continue;

        let videoUrl = lessonUrls[i] || `/videos/stream/anat-m1-l${i + 1}`;
        if (uploadedFiles[`video_file_${i}`]) {
          videoUrl = `/uploads/lessons/${uploadedFiles[`video_file_${i}`]}`;
        } else if (i === 0 && uploadedFiles['video_file']) {
          videoUrl = `/uploads/lessons/${uploadedFiles['video_file']}`;
        }

        const duration = parseInt(lessonDurations[i] || 15, 10);
        const notes = lessonNotes[i] || '';

        const currentLessonCount = (await db.prepare(`SELECT COUNT(*) as cnt FROM lessons WHERE module_id = ?`).get(targetModuleId))?.cnt || 0;
        await Course.addLesson(targetModuleId, {
          title,
          type: 'video',
          content: notes,
          video_url: videoUrl,
          duration_minutes: duration,
          sort_order: currentLessonCount + 1,
          is_preview: 0
        });
      }
    }

    if (data.is_publish === '1') {
      req.flash('success', '🎉 Course Published Successfully with Multiple Video Lessons & Interactive Features!');
      return res.redirect('/instructor/courses');
    }

    req.flash('success', '💾 Course & Video Lessons Saved Successfully!');
    res.redirect(`/instructor/courses/wizard?courseId=${courseId}`);
  } catch (err) {
    console.error('Save Course Wizard Error:', err);
    req.flash('error', 'Could not save course data.');
    res.redirect('/instructor/courses');
  }
};

exports.publishCourseToggle = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) {
    req.flash('error', 'Course not found.');
    return res.redirect('/instructor/courses');
  }
  const newStatus = course.status === 'published' ? 'draft' : 'published';
  await db.prepare('UPDATE courses SET status = ? WHERE id = ?').run(newStatus, course.id);
  req.flash('success', `Course status updated to ${newStatus.toUpperCase()}!`);
  res.redirect('/instructor/courses');
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
