const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');
const { requireAuth } = require('../middleware/auth');

router.get('/', publicController.home);

router.get('/subjects', publicController.subjectsIndex);
router.get('/subjects/:slug/module/:section', publicController.subjectSectionDetail);
router.get('/subjects/:slug', publicController.subjectDetail);

router.get('/courses', publicController.courseList);
router.get('/courses/:slug', publicController.courseDetail);

router.get('/about', publicController.about);
router.get('/the-team', publicController.theTeam);

router.get('/blog', publicController.blogIndex);
router.get('/blog/:slug', publicController.blogDetail);

router.get('/live-sessions', publicController.liveSessions);
router.post('/live-sessions/:id/register', requireAuth, publicController.registerForSession);

router.get('/contact', publicController.contact);
router.post('/contact', publicController.submitContact);
router.post('/appointments', publicController.submitAppointment);

router.get('/instructors/:id', publicController.instructorProfile);

module.exports = router;
