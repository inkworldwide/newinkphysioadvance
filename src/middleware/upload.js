const fs = require('fs');
const path = require('path');
const multer = require('multer');

const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const VIDEO_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'lessons');
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    cb(null, `user-${req.session.user.id}-${Date.now()}${safeExt}`);
  }
});

function imageFileFilter(req, file, cb) {
  const allowed = /jpeg|jpg|png|webp|gif/;
  const isAllowed = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
  if (isAllowed) return cb(null, true);
  cb(new Error('Only image files (jpg, png, webp, gif) are allowed.'));
}

const uploadAvatar = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: imageFileFilter
});

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VIDEO_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.mp4').toLowerCase();
    const safeExt = ['.mp4', '.webm', '.ogg'].includes(ext) ? ext : '.mp4';
    cb(null, `lesson-${Date.now()}-${Math.round(Math.random() * 1e6)}${safeExt}`);
  }
});

function videoFileFilter(req, file, cb) {
  const allowed = /mp4|webm|ogg/;
  const isAllowed = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
  if (isAllowed) return cb(null, true);
  cb(new Error('Only video files (mp4, webm, ogg) are allowed.'));
}

const uploadLessonVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: videoFileFilter
});

module.exports = { uploadAvatar, uploadLessonVideo };
