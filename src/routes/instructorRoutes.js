const express = require('express');
const router = express.Router();
const instructorController = require('../controllers/instructorController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('instructor', 'admin'));

router.get('/dashboard', instructorController.dashboard);
router.get('/profile', instructorController.profile);

router.get('/courses', instructorController.courseList);
router.get('/courses/wizard', instructorController.courseWizardView);
router.post('/courses/wizard/save', instructorController.saveCourseWizard);
router.post('/courses/:id/publish', instructorController.publishCourseToggle);
router.get('/courses/new', instructorController.newCourseForm);
router.post('/courses', instructorController.createCourse);
router.get('/courses/:id/edit', instructorController.editCourseForm);
router.post('/courses/:id', instructorController.updateCourse);
router.post('/courses/:id/delete', instructorController.deleteCourse);
router.get('/courses/:id/students', instructorController.students);
router.get('/courses/:id/attendance', require('../controllers/attendanceController').courseAttendance);

router.post('/courses/:courseId/modules', instructorController.addModule);
router.post('/courses/:courseId/modules/:moduleId/delete', instructorController.deleteModule);

const { uploadLessonVideo } = require('../middleware/upload');

function handleLessonVideoUpload(req, res, next) {
  uploadLessonVideo.single('video_file')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message && err.message.includes('File too large')
        ? 'Video is too large. Please choose a file under 200MB.'
        : (err.message || 'Could not upload that video.'));
      return res.redirect(`/instructor/courses/${req.params.courseId}/edit`);
    }
    next();
  });
}

router.post('/courses/:courseId/modules/:moduleId/lessons', handleLessonVideoUpload, instructorController.addLesson);
router.post('/courses/:courseId/lessons/:lessonId/delete', instructorController.deleteLesson);

router.post('/courses/:courseId/quizzes', instructorController.addQuiz);
router.get('/courses/:courseId/quizzes/:quizId', instructorController.quizDetail);
router.post('/courses/:courseId/quizzes/:quizId/questions', instructorController.addQuestion);
router.post('/courses/:courseId/quizzes/:quizId/questions/:questionId/delete', instructorController.deleteQuestion);
router.post('/courses/:courseId/quizzes/:quizId/delete', instructorController.deleteQuiz);

module.exports = router;
