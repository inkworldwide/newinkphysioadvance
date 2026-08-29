const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));

router.get('/dashboard', adminController.dashboard);
router.get('/profile', adminController.profile);

router.get('/courses', adminController.courses);
router.post('/courses/:id/toggle-featured', adminController.toggleFeatured);
router.post('/courses/:id/toggle-status', adminController.toggleStatus);
router.post('/courses/:id/delete', adminController.deleteCourse);

router.get('/users', adminController.users);
router.get('/users/:id', adminController.userDetail);
router.post('/users/:id/toggle-active', adminController.toggleUserActive);
router.post('/users/:id/delete', adminController.deleteUser);
router.post('/users/:id/reset-password', adminController.resetUserPassword);

router.get('/categories', adminController.categories);
router.post('/categories', adminController.addCategory);
router.post('/categories/:id/delete', adminController.deleteCategory);

router.get('/orders', adminController.orders);

router.get('/features', adminController.heroFeaturesIndex);
router.post('/features', adminController.addHeroFeature);
router.get('/features/:id/edit', adminController.editHeroFeature);
router.post('/features/:id/update', adminController.updateHeroFeature);
router.post('/features/:id/delete', adminController.deleteHeroFeature);

router.get('/specialties', adminController.specialtiesIndex);
router.post('/specialties', adminController.addSpecialty);
router.get('/specialties/:id/edit', adminController.editSpecialty);
router.post('/specialties/:id/update', adminController.updateSpecialty);
router.post('/specialties/:id/toggle', adminController.toggleSpecialty);
router.post('/specialties/:id/delete', adminController.deleteSpecialty);

router.get('/team', adminController.teamIndex);
router.post('/team', adminController.addTeamMember);
router.get('/team/:id/edit', adminController.editTeamMember);
router.post('/team/:id/update', adminController.updateTeamMember);
router.get('/team/:id/toggle-about', adminController.toggleAboutShow);
router.post('/team/:id/toggle-about', adminController.toggleAboutShow);
router.get('/team/:id/toggle-active', adminController.toggleTeamMemberActive);
router.post('/team/:id/toggle-active', adminController.toggleTeamMemberActive);
router.post('/team/:id/reorder', adminController.reorderTeamMember);
router.post('/team/:id/delete', adminController.deleteTeamMember);

router.get('/blog', adminController.blogIndex);
router.post('/blog', adminController.addBlogPost);
router.post('/blog/:id/delete', adminController.deleteBlogPost);

router.get('/live-sessions', adminController.liveSessionsIndex);
router.post('/live-sessions', adminController.createLiveSession);
router.post('/live-sessions/:id/delete', adminController.deleteLiveSession);
router.post('/live-sessions/:id/notify', adminController.notifyRegistrants);

router.get('/appointments', adminController.appointmentsIndex);
router.post('/appointments/:id/status', adminController.updateAppointmentStatus);

module.exports = router;
