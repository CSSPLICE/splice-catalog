import gulp from 'gulp';
import ts from 'gulp-typescript';

export function assets() {
  return gulp.src('./src/public/**/*.*').pipe(gulp.dest('./dist/public'));
}

export function views() {
  return gulp.src('./src/views/**/*.ejs').pipe(gulp.dest('./dist/views'));
}

export default gulp.series(assets, views, () => {
  console.log('gulp done');
});
