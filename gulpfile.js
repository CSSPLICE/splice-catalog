var gulp = require("gulp");
var ts = require("gulp-typescript");

gulp.task("views", function () {
  return gulp.src("./src/views/**/*.ejs").pipe(gulp.dest("./dist/views"));
});

gulp.task("default", gulp.series("views"), () => {
    console.log("gulp done");
});