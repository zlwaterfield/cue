// A new account for every run, so flows never depend on each other.
output.email = (typeof PREFIX !== 'undefined' ? PREFIX : 'e2e') + '-' + Date.now() + '@example.com'
