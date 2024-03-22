var gulp = require('gulp');
var ts = require('gulp-typescript');

gulp.task('assets', function () {
  return gulp.src('./src/public/**/*.*').pipe(gulp.dest('./dist/src/public'));
});

gulp.task('views', function () {
  return gulp.src('./src/views/**/*.ejs').pipe(gulp.dest('./dist/src/views'));
});

gulp.task('default', gulp.series('assets', 'views'), () => {
  console.log('gulp done');
});
