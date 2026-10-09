package ch.duartesantos.opengym;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.contract.ActivityResultContract;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.Record;
import androidx.health.connect.client.records.SleepSessionRecord;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.records.DistanceRecord;
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord;
import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.aggregate.AggregateRequest;
import androidx.health.connect.client.aggregate.AggregateMetric;
import androidx.health.connect.client.aggregate.AggregationResult;
import androidx.health.connect.client.time.TimeRangeFilter;
import java.time.Duration;
import java.time.Instant;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.Metadata;
import androidx.health.connect.client.units.Mass;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlinx.coroutines.BuildersKt;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Writes finished workouts and weigh-ins to Health Connect (#200), the phone's own store for
 * health data, so other apps can read them. Write-only and off until the user turns it on in
 * Settings: no permission is asked for before that. What to write is worked out in JS
 * (lib/health-connect.js); this side only turns those plain objects into records.
 *
 * Every record carries openGym's own id as its clientRecordId, so writing it again replaces it,
 * and "remove" finds exactly the records openGym wrote. The version is the time of the write:
 * Health Connect keeps a rewritten record only when its version is higher than the stored one.
 *
 * The client's API is Kotlin suspend functions. They are called from a worker thread through
 * runBlocking, which keeps the Android project Java-only.
 *
 * The client library needs Android 8 (API 26) and Health Connect itself Android 9 (API 28); the
 * app supports Android 6, so every entry point checks the version before a Health Connect class
 * is touched, and answers "unsupported" below 9.
 *
 * Usage from JS (lib/health-sync.js):
 *   const HC = registerPlugin('HealthConnect');
 *   await HC.status();              // { status: 'available' | 'update' | 'missing' | 'unsupported', granted }
 *   await HC.requestPermissions();  // { granted }
 *   await HC.write({ sessions: [...], weights: [...] });
 *   await HC.remove({ sessions: [ids], weights: [ids] });
 *   await HC.openSettings();        // Health Connect's data screen, or its store page
 */
@CapacitorPlugin(name = "HealthConnect")
public class HealthConnectPlugin extends Plugin {

    private static final String PROVIDER = "com.google.android.apps.healthdata";
    // The literal permission names, as declared in AndroidManifest.xml.
    private static final String WRITE_EXERCISE = "android.permission.health.WRITE_EXERCISE";
    private static final String WRITE_WEIGHT = "android.permission.health.WRITE_WEIGHT";
    // PERSONAL-READ: read path (HealthConnectPlugin.read + lib/health-read.js).
    // Separate set from permissions(): the write toggle's granted-check must
    // not start demanding read grants, and vice versa.
    private static final String READ_EXERCISE = "android.permission.health.READ_EXERCISE";
    private static final String READ_STEPS = "android.permission.health.READ_STEPS";
    private static final String READ_DISTANCE = "android.permission.health.READ_DISTANCE";
    private static final String READ_CALORIES = "android.permission.health.READ_TOTAL_CALORIES_BURNED";
    private static final String READ_SLEEP = "android.permission.health.READ_SLEEP";
    private static final String READ_HEART_RATE = "android.permission.health.READ_HEART_RATE";
    // Health Connect takes at most this many records in one insert.
    private static final int CHUNK = 500;

    // One at a time, in order: a remove queued behind a write must not overtake it.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    }

    private static Set<String> permissions() {
        Set<String> p = new HashSet<>();
        p.add(WRITE_EXERCISE);
        p.add(WRITE_WEIGHT);
        return p;
    }

    // PERSONAL-READ: the read set, kept apart from permissions() so the two
    // toggles (write workouts out / read phone data in) never gate each other.
    private static Set<String> readPermissions() {
        Set<String> p = new HashSet<>();
        p.add(READ_EXERCISE);
        p.add(READ_STEPS);
        p.add(READ_DISTANCE);
        p.add(READ_CALORIES);
        p.add(READ_SLEEP);
        p.add(READ_HEART_RATE);
        return p;
    }

    private String sdkStatus() {
        if (!supported()) return "unsupported";
        int s = HealthConnectClient.Companion.getSdkStatus(getContext(), PROVIDER);
        if (s == HealthConnectClient.SDK_AVAILABLE) return "available";
        if (s == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update";
        // Android 13 and lower need the Health Connect app; 14 and up have it built in, so
        // "missing" there means the phone has no Health Connect at all (some Android Go builds).
        return Build.VERSION.SDK_INT >= 34 ? "unsupported" : "missing";
    }

    private HealthConnectClient client() {
        return HealthConnectClient.Companion.getOrCreate(getContext(), PROVIDER);
    }

    @SuppressWarnings("unchecked")
    private Set<String> granted() throws InterruptedException {
        PermissionController pc = client().getPermissionController();
        return (Set<String>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> pc.getGrantedPermissions(cont));
    }

    @PluginMethod
    public void status(PluginCall call) {
        String status = sdkStatus();
        if (!"available".equals(status)) {
            JSObject r = new JSObject();
            r.put("status", status);
            r.put("granted", false);
            call.resolve(r);
            return;
        }
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("status", status);
                r.put("granted", granted().containsAll(permissions()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Intent intent = contract.createIntent(getContext(), permissions());
        startActivityForResult(call, intent, "permissionsResult");
    }

    @ActivityCallback
    private void permissionsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Set<String> got = contract.parseResult(result.getResultCode(), result.getData());
        // The dialog answers only for this time; ask Health Connect what stands now, since the
        // user may also have granted one of the two and not the other.
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("granted", (got != null && got.containsAll(permissions())) || granted().containsAll(permissions()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights = call.getArray("weights", new JSArray());
        worker.execute(() -> {
            try {
                long version = System.currentTimeMillis();
                List<Record> records = new ArrayList<>();
                for (int i = 0; i < sessions.length(); i++) records.add(session(sessions.getJSONObject(i), version));
                for (int i = 0; i < weights.length(); i++) records.add(weight(weights.getJSONObject(i), version));
                for (int from = 0; from < records.size(); from += CHUNK) {
                    List<Record> part = records.subList(from, Math.min(records.size(), from + CHUNK));
                    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().insertRecords(part, cont));
                }
                call.resolve();
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights = call.getArray("weights", new JSArray());
        worker.execute(() -> {
            try {
                delete(ExerciseSessionRecord.class, ids(sessions));
                delete(WeightRecord.class, ids(weights));
                call.resolve();
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    // PERSONAL-READ: pull phone health data in (lib/health-read.js drives it).
    // Params startMs/endMs (epoch millis; end defaults to now). Resolves
    // sessions (with originating app package, so JS skips records this app
    // wrote itself), window totals (steps, distance, calories, HR min/avg/max)
    // and sleep sessions with summed light/deep/rem/awake minutes. Per-session
    // distance/calories come from windowed aggregates over each session.
    // UNTESTED without an Android SDK build (see HEALTH-CONNECT-PLAN.md):
    // written against connect-client 1.1.0-alpha12 in this file's own
    // runBlocking/worker idiom. Compile with Android Studio before trusting.
    @PluginMethod
    public void read(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        long endMs = call.getLong("endMs", System.currentTimeMillis());
        long startMs = call.getLong("startMs", endMs - 30L * 86400000L);
        worker.execute(() -> {
            try {
                if (!granted().containsAll(readPermissions())) {
                    call.reject("Health Connect read permission not granted", "permission");
                    return;
                }
                TimeRangeFilter range = TimeRangeFilter.Companion.between(
                        Instant.ofEpochMilli(startMs), Instant.ofEpochMilli(endMs));
                JSObject out = new JSObject();
                out.put("sessions", readSessions(range));
                JSObject totals = readTotals(range);
                out.put("steps", totals.optLong("steps", 0));
                out.put("distanceM", totals.optDouble("distanceM", 0));
                out.put("caloriesKcal", totals.optDouble("caloriesKcal", 0));
                out.put("hrMin", totals.optLong("hrMin", 0));
                out.put("hrAvg", totals.optLong("hrAvg", 0));
                out.put("hrMax", totals.optLong("hrMax", 0));
                out.put("sleep", readSleep(range));
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    private JSArray readSessions(TimeRangeFilter range) throws Exception {
        JSArray out = new JSArray();
        String token = null;
        do {
            ReadRecordsRequest<ExerciseSessionRecord> req = new ReadRecordsRequest<>(
                    JvmClassMappingKt.getKotlinClass(ExerciseSessionRecord.class),
                    range, Collections.emptySet(), true, 1000, token);
            ReadRecordsResponse<ExerciseSessionRecord> res =
                    (ReadRecordsResponse<ExerciseSessionRecord>) BuildersKt.runBlocking(
                            EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().readRecords(req, cont));
            for (ExerciseSessionRecord r : res.getRecords()) {
                JSONObject o = new JSONObject();
                o.put("start", r.getStartTime().toEpochMilli());
                o.put("end", r.getEndTime().toEpochMilli());
                o.put("type", r.getExerciseType());
                o.put("typeName", readTypeName(r.getExerciseType()));
                o.put("title", r.getTitle() != null ? r.getTitle() : "");
                o.put("app", r.getMetadata().getDataOrigin().getPackageName());
                JSObject window = readTotals(TimeRangeFilter.Companion.between(
                        r.getStartTime(), r.getEndTime()));
                o.put("distanceM", window.optDouble("distanceM", 0));
                o.put("caloriesKcal", window.optDouble("caloriesKcal", 0));
                out.put(o);
            }
            token = res.getPageToken();
        } while (token != null);
        return out;
    }

    private JSObject readTotals(TimeRangeFilter range) throws Exception {
        Set<AggregateMetric<?>> metrics = new HashSet<>();
        metrics.add(StepsRecord.COUNT_TOTAL);
        metrics.add(DistanceRecord.DISTANCE_TOTAL);
        metrics.add(TotalCaloriesBurnedRecord.ENERGY_TOTAL);
        metrics.add(HeartRateRecord.BPM_MIN);
        metrics.add(HeartRateRecord.BPM_AVG);
        metrics.add(HeartRateRecord.BPM_MAX);
        AggregateRequest<?> req = new AggregateRequest<>(metrics, range, Collections.emptySet());
        AggregationResult res = (AggregationResult) BuildersKt.runBlocking(
                EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().aggregate(req, cont));
        JSObject out = new JSObject();
        try { out.put("steps", res.getLong(StepsRecord.COUNT_TOTAL)); } catch (Exception ignored) {}
        try { out.put("distanceM", res.getDouble(DistanceRecord.DISTANCE_TOTAL)); } catch (Exception ignored) {}
        try { out.put("caloriesKcal", res.getDouble(TotalCaloriesBurnedRecord.ENERGY_TOTAL)); } catch (Exception ignored) {}
        try { out.put("hrMin", res.getLong(HeartRateRecord.BPM_MIN)); } catch (Exception ignored) {}
        try { out.put("hrAvg", res.getLong(HeartRateRecord.BPM_AVG)); } catch (Exception ignored) {}
        try { out.put("hrMax", res.getLong(HeartRateRecord.BPM_MAX)); } catch (Exception ignored) {}
        return out;
    }

    private JSArray readSleep(TimeRangeFilter range) throws Exception {
        JSArray out = new JSArray();
        String token = null;
        do {
            ReadRecordsRequest<SleepSessionRecord> req = new ReadRecordsRequest<>(
                    JvmClassMappingKt.getKotlinClass(SleepSessionRecord.class),
                    range, Collections.emptySet(), true, 200, token);
            ReadRecordsResponse<SleepSessionRecord> res =
                    (ReadRecordsResponse<SleepSessionRecord>) BuildersKt.runBlocking(
                            EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().readRecords(req, cont));
            for (SleepSessionRecord r : res.getRecords()) {
                long light = 0, deep = 0, rem = 0, awake = 0;
                for (SleepSessionRecord.Stage s : r.getStages()) {
                    long mins = Duration.between(s.getStartTime(), s.getEndTime()).toMinutes();
                    switch (s.getStage()) {
                        case SleepSessionRecord.STAGE_TYPE_LIGHT_SLEEP: light += mins; break;
                        case SleepSessionRecord.STAGE_TYPE_DEEP_SLEEP: deep += mins; break;
                        case SleepSessionRecord.STAGE_TYPE_REM_SLEEP: rem += mins; break;
                        case SleepSessionRecord.STAGE_TYPE_AWAKE:
                        case SleepSessionRecord.STAGE_TYPE_OUT_OF_BED: awake += mins; break;
                        default: break;
                    }
                }
                JSONObject o = new JSONObject();
                o.put("start", r.getStartTime().toEpochMilli());
                o.put("end", r.getEndTime().toEpochMilli());
                o.put("lightMin", light);
                o.put("deepMin", deep);
                o.put("remMin", rem);
                o.put("awakeMin", awake);
                out.put(o);
            }
            token = res.getPageToken();
        } while (token != null);
        return out;
    }

    // Inverse of exerciseType(): names cross the bridge, ints stay in Java.
    private static String readTypeName(int type) {
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING) return "strength_training";
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_WALKING) return "walking";
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_RUNNING) return "running";
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY) return "biking_stationary";
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL) return "elliptical";
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE) return "stair_climbing_machine";
        return "other";
    }

    // Health Connect's own screen for the data apps wrote, where the user can look at and delete
    // what openGym wrote. Without Health Connect (Android 13 and lower), its store page instead.
    @PluginMethod
    public void openSettings(PluginCall call) {
        String status = sdkStatus();
        if ("unsupported".equals(status)) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        try {
            Intent intent = "available".equals(status)
                    ? HealthConnectClient.Companion.getHealthConnectManageDataIntent(getContext(), PROVIDER)
                    : new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + PROVIDER + "&url=healthconnect%3A%2F%2Fonboarding"));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), "failed");
        }
    }

    private void delete(Class<? extends Record> type, List<String> clientIds) throws InterruptedException {
        for (int from = 0; from < clientIds.size(); from += CHUNK) {
            List<String> part = clientIds.subList(from, Math.min(clientIds.size(), from + CHUNK));
            BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) ->
                    client().deleteRecords(JvmClassMappingKt.getKotlinClass(type), Collections.emptyList(), part, cont));
        }
    }

    private static List<String> ids(JSArray array) throws JSONException {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) out.add(array.getString(i));
        return out;
    }

    // The offset in force at that moment where the phone is now: what Health Connect shows the
    // session's local time with.
    private static ZoneOffset offsetAt(Instant at) {
        return ZoneId.systemDefault().getRules().getOffset(at);
    }

    private static ExerciseSessionRecord session(JSONObject s, long version) throws JSONException {
        Instant start = Instant.ofEpochMilli(s.getLong("start"));
        Instant end = Instant.ofEpochMilli(s.getLong("end"));
        String title = s.optString("title", "");
        String notes = s.optString("notes", "");
        return new ExerciseSessionRecord(
                start, offsetAt(start), end, offsetAt(end),
                Metadata.manualEntry(s.getString("id"), version),
                exerciseType(s.optString("type")),
                title.isEmpty() ? null : title,
                notes.isEmpty() ? null : notes);
    }

    private static WeightRecord weight(JSONObject w, long version) throws JSONException {
        Instant time = Instant.ofEpochMilli(w.getLong("time"));
        return new WeightRecord(time, offsetAt(time), Mass.kilograms(w.getDouble("kg")),
                Metadata.manualEntry(w.getString("id"), version));
    }

    // The names lib/health-connect.js uses (SESSION_TYPES); anything else is "other".
    private static int exerciseType(String name) {
        switch (name) {
            case "strength_training": return ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING;
            case "walking": return ExerciseSessionRecord.EXERCISE_TYPE_WALKING;
            case "running": return ExerciseSessionRecord.EXERCISE_TYPE_RUNNING;
            case "biking_stationary": return ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY;
            case "elliptical": return ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL;
            case "stair_climbing_machine": return ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE;
            default: return ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT;
        }
    }
}
