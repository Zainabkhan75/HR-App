export default function ForgotUsername(){
 return <main className="login"><section className="panel">
  <div className="eyebrow">SEIDOHR / BANDANA</div>
  <h1>Forgot username?</h1>
  <p>You can sign in using the email registered for your HRMS account instead of your username.</p>
  <a className="recovery-action" href="/login">Sign in with your email</a>
  <h2>Need your username?</h2>
  <p>Contact HR with your full name and employee ID. HR can verify your identity and confirm your username.</p>
  <p>If you do not have a registered email or do not know which email is linked, contact HR for help.</p>
  <nav className="recovery-links" aria-label="Account recovery"><a href="/login">Back to sign in</a><a href="/forgot-password">Forgot password?</a></nav>
 </section></main>
}
