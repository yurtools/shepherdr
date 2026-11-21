// Link against the existing installed engine archive; do not rebuild the engine.
// See docs/promise-leak-validation.md for provenance and the exact command.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "quickjs.h"

static void fail(JSContext *ctx, const char *where) {
    JSValue error = JS_GetException(ctx);
    const char *message = JS_ToCString(ctx, error);
    fprintf(stderr, "%s: %s\n", where, message ? message : "exception");
    JS_FreeCString(ctx, message); JS_FreeValue(ctx, error); exit(1);
}
static void drain(JSContext *ctx) {
    JSContext *next; int status, jobs = 0;
    while ((status = JS_ExecutePendingJob(JS_GetRuntime(ctx), &next)) > 0)
        if (++jobs > 1000000) { fputs("job budget exceeded\n", stderr); exit(1); }
    if (status < 0) fail(next, "job");
}
static void run(JSContext *ctx, const char *code, const char *name, int type) {
    JSValue value = JS_Eval(ctx, code, strlen(code), name, type);
    if (JS_IsException(value)) fail(ctx, name);
    JS_FreeValue(ctx, value); drain(ctx);
}
static void collect(JSContext *ctx) {
    // FinalizationRegistry cleanup is queued work in this engine.
    for (int i = 0; i < 3; i++) { JS_RunGC(JS_GetRuntime(ctx)); drain(ctx); }
}
static void file(JSContext *ctx, const char *path, const char *suffix, int type) {
    FILE *f = fopen(path, "rb"); if (!f) { perror(path); exit(1); }
    fseek(f, 0, SEEK_END); long size = ftell(f); rewind(f);
    char *code = calloc((size_t)size + strlen(suffix) + 1, 1);
    if (!code || fread(code, 1, (size_t)size, f) != (size_t)size) exit(1);
    fclose(f); strcat(code, suffix); run(ctx, code, path, type); free(code);
}
int main(int argc, char **argv) {
    if (argc != 3) { fputs("usage: memory helper.js driver.js\n", stderr); return 2; }
    const char *modes[] = {"repeated_race", "helper_timeout", "helper_replace", "helper_dispose", "helper_reload"};
    const int targets[] = {1000, 5000, 10000, 20000, 40000};
    puts("pattern,iterations,heap_bytes,objects");
    for (int m = 0; m < 5; m++) {
        JSRuntime *rt = JS_NewRuntime(); JSContext *ctx = JS_NewContext(rt);
        JS_SetMemoryLimit(rt, 256 * 1024 * 1024);
        file(ctx, argv[1], "\nglobalThis.BoundedWait=BoundedWait;globalThis.TIMEOUT=TIMEOUT;globalThis.DISPOSED=DISPOSED;", JS_EVAL_TYPE_MODULE);
        file(ctx, argv[2], "", JS_EVAL_TYPE_GLOBAL);
        char code[256]; snprintf(code, sizeof(code), "globalThis.mode='%s';", modes[m]);
        run(ctx, code, "mode", JS_EVAL_TYPE_GLOBAL);
        for (int j = 0, count = 0; j < 5; j++) {
            while (count < targets[j]) {
                run(ctx, "step(100);", "step", JS_EVAL_TYPE_GLOBAL);
                run(ctx, "if(!done || failure)throw Error(failure || 'unfinished step');", "assert", JS_EVAL_TYPE_GLOBAL);
                collect(ctx); count += 100;
            }
            run(ctx, "check();", "check", JS_EVAL_TYPE_GLOBAL);
            JSMemoryUsage usage; JS_ComputeMemoryUsage(rt, &usage);
            printf("%s,%d,%lld,%lld\n", modes[m], count, (long long)usage.malloc_size, (long long)usage.obj_count);
        }
        run(ctx, "deliver();", "delivery", JS_EVAL_TYPE_GLOBAL);
        run(ctx, "if(!done || failure)throw Error(failure || 'unfinished delivery');", "assert", JS_EVAL_TYPE_GLOBAL);
        collect(ctx); JS_FreeContext(ctx); JS_FreeRuntime(rt);
    }
    return 0;
}
