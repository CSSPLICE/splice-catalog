Dependabot periodically gives us notice that there are vulnerabilities related to some of our packages.
To clear these, there is now a github action that should weekly open dependabot PRs that resolve these by updating our dependencies in the yarn lock file.
To ensure that things continue working, each PR should be checked out and made sure that the app still runs.
To do this:
  * `docker compose --profile production build`
  * `docker compose --profile production up`

Then make sure the app comes up as expected.
This doesn't need to be a rigorous functionality check, most issues from updating the packages should show as build errors in the docker log, but clicking through page or two wouldn't be a bad idea.
