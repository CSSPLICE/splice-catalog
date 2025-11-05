import gulp from 'gulp';
import ts from 'gulp-typescript';

export function assets() {
  return gulp.src('./src/public/**/*.*').pipe(gulp.dest('./dist/public'));
}

export function views() {
  return gulp.src('./src/views/**/*.ejs').pipe(gulp.dest('./dist/views'));
}

function finish(done) {
  console.log('gulp done');
  done();
}

export default gulp.series(assets, views, finish);
