const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const androidRoot = path.join(__dirname, '..', 'android', 'app', 'src', 'main');
const manifest = fs.readFileSync(path.join(androidRoot, 'AndroidManifest.xml'), 'utf8');

function source(relativePath) {
  return fs.readFileSync(path.join(androidRoot, 'java', 'com', 'darksound186', 'asistentefinanciero', relativePath), 'utf8');
}

function component(tag, name) {
  const escapedName = name.replaceAll('.', '\\.');
  const match = manifest.match(new RegExp(`<${tag}\\s+android:name="${escapedName}"([^>]*)>`));
  assert.ok(match, `${tag} ${name} is declared`);
  return match[1];
}

test('only the launcher and protected notification listener are externally reachable', () => {
  assert.match(manifest, /<uses-permission android:name="android\.permission\.INTERNET"/);
  assert.match(manifest, /<uses-permission android:name="android\.permission\.POST_NOTIFICATIONS"/);
  assert.doesNotMatch(manifest, /READ_SMS|RECEIVE_SMS|READ_PHONE_STATE|QUERY_ALL_PACKAGES/);
  assert.match(component('activity', '.MainActivity'), /android:exported="false"/);
  assert.match(component('activity', '.ReviewExpenseActivity'), /android:exported="false"/);
  assert.match(component('receiver', '.SaveExpenseReceiver'), /android:exported="false"/);
  assert.match(component('activity', '.MainLauncherActivity'), /android:exported="true"/);
  assert.match(component('service', '.ExpenseNotificationListener'),
    /android:exported="true"[\s\S]*android:permission="android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE"/);

  const filters = [...manifest.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map(match => match[1]);
  assert.equal(filters.length, 2);
  assert.match(filters[0], /android\.intent\.action\.MAIN/);
  assert.match(filters[0], /android\.intent\.category\.LAUNCHER/);
  assert.match(filters[1], /android\.service\.notification\.NotificationListenerService/);
});

test('external launcher drops incoming data; receiver can only open the review screen', () => {
  const launcher = source('MainLauncherActivity.java');
  const receiver = source('SaveExpenseReceiver.java');
  assert.match(launcher, /new Intent\(this, MainActivity\.class\)/);
  assert.doesNotMatch(launcher, /getIntent\(|putExtra\(|getData\(/);
  assert.match(receiver, /new Intent\(context, ReviewExpenseActivity\.class\)/);
  assert.doesNotMatch(receiver, /new Intent\(context, MainActivity\.class\)/);
  assert.match(receiver, /ExpenseNotifications\.loadCapture\(context, captureId\)/);
});

test('notification source is package-allowlisted and each write requires expense review', () => {
  const providers = source('ExpenseSources.java');
  const listener = source('ExpenseNotificationListener.java');
  const notifications = source('ExpenseNotifications.java');
  const receiver = source('SaveExpenseReceiver.java');
  const review = source('ReviewExpenseActivity.java');
  const parser = source('NotificationParser.java');
  const parserTests = fs.readFileSync(path.join(androidRoot, '..', 'test', 'java', 'com',
    'darksound186', 'asistentefinanciero', 'NotificationParserTest.java'), 'utf8');
  const sourceVerifier = providers;
  const securityDoc = fs.readFileSync(path.join(__dirname, '..', 'android', 'SECURITY.md'), 'utf8');
  const main = source('MainActivity.java');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  for (const packageName of [
    'com.nequi.MobileApp',
    'co.com.bancolombia.personas.superapp',
    'com.nu.production',
    'com.google.android.apps.walletnfcrel'
  ]) assert.ok(providers.includes(`"${packageName}"`));
  assert.match(manifest, /<package android:name="com\.nequi\.MobileApp"/);
  assert.match(manifest, /<package android:name="co\.com\.bancolombia\.personas\.superapp"/);
  assert.match(sourceVerifier, /isOfficiallyVerified\(PackageManager packageManager, String packageName\)/);
  assert.match(listener, /providerForPackage\(posted\.getPackageName\(\)\)/);
  assert.match(listener, /if \(!verified\) suggestedType = NotificationParser\.TYPE_UNKNOWN/);
  assert.doesNotMatch(listener, /getApplicationLabel|\.contains\("nequi"\)/);
  assert.match(listener, /rememberOnce\(captureId\)/);
  assert.match(listener, /seen\.size\(\) > 250/);
  assert.match(listener, /packageName \+ "\|" \+ notificationTime \+ "\|" \+ amount \+ "\|" \+ text/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(notifications, /putLong\(key \+ "_amount"/);
  assert.match(receiver, /ExpenseNotifications\.loadCapture\(context, captureId\)/);
  assert.match(sourceVerifier, /OFFICIAL_SHA256_CERTIFICATES = Collections\.emptyMap\(\)/);
  assert.match(securityDoc, /Fingerprints/);
  assert.match(securityDoc, /No se inventan/);
  assert.match(receiver, /description\.isEmpty\(\) \|\| description\.length\(\) > 200/);
  assert.match(review, /amountField = new EditText\(this\)/);
  assert.match(review, /descriptionField = new EditText\(this\)/);
  assert.match(review, /NotificationParser\.TYPE_PURCHASE\.equals\(selectedType\(\)\)/);
  assert.match(review, /amount <= 0 \|\| amount > MAX_AMOUNT/);
  assert.match(review, /description\.isEmpty\(\) \|\| description\.length\(\) > 200/);
  assert.match(parser, /TYPE_TRANSFER_SENT/);
  assert.match(parser, /TYPE_TRANSFER_RECEIVED/);
  assert.match(parser, /TYPE_INFORMATIONAL/);
  assert.match(parser, /TYPE_UNKNOWN/);
  assert.match(parser, /extractUniqueCopAmount/);
  assert.match(parserTests, /Recibiste transferencia de Persona B/);
  assert.match(parserTests, /Compra \$12\.500; saldo \$80\.000/);
  assert.match(parserTests, /Purchase for USD/);
  assert.match(main, /ExpenseSources\.isKnownProviderLabel\(source\)/);
  assert.match(main, /CAPTURE_ID\.matcher\(captureId\)\.matches\(\)/);
  assert.match(app, /cp\.expenses\.some\(item => item\.id === id\)/);
});
