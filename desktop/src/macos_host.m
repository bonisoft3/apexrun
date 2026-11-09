#import <AppKit/AppKit.h>
#import "apple_host_common.h"

// Custom 15-node Sega Route Matrix Pyramid view (matches `.hud-matrix-svg` in `arena.html` & `hud.js`)
@interface ApexRouteMatrixView : NSView
@property (nonatomic, assign) int activeNodeIndex;
@end

@implementation ApexRouteMatrixView

- (void)drawRect:(NSRect)dirtyRect {
    (void)dirtyRect;
    CGFloat W = self.bounds.size.width;
    CGFloat H = self.bounds.size.height;
    // 5 rows: row r has (r + 1) nodes, total 15 nodes (indices 0..14)
    CGPoint pts[15];
    int idx = 0;
    for (int r = 0; r < 5; r++) {
        int count = r + 1;
        CGFloat y = H - 8.0 - (CGFloat)r * ((H - 16.0) / 4.0);
        CGFloat rowSpan = (CGFloat)r * 26.0;
        CGFloat startX = (W - rowSpan) * 0.5;
        for (int c = 0; c < count; c++) {
            CGFloat x = (count == 1) ? (W * 0.5) : (startX + (CGFloat)c * 26.0);
            pts[idx++] = CGPointMake(x, y);
        }
    }

    int activeRow = 0;
    int accum = 0;
    for (int r = 0; r < 5; r++) {
        if (self.activeNodeIndex >= accum && self.activeNodeIndex < accum + r + 1) {
            activeRow = r;
            break;
        }
        accum += r + 1;
    }
    int leftChild = (activeRow < 4) ? (self.activeNodeIndex + activeRow + 1) : -1;
    int rightChild = (activeRow < 4) ? (self.activeNodeIndex + activeRow + 2) : -1;

    // Draw connecting edges between row r and row r+1
    int rowBase = 0;
    for (int r = 0; r < 4; r++) {
        int nextBase = rowBase + r + 1;
        for (int c = 0; c <= r; c++) {
            int pIdx = rowBase + c;
            int lIdx = nextBase + c;
            int rIdx = nextBase + c + 1;

            NSBezierPath *edgeL = [NSBezierPath bezierPath];
            [edgeL moveToPoint:pts[pIdx]];
            [edgeL lineToPoint:pts[lIdx]];
            edgeL.lineWidth = (pIdx == self.activeNodeIndex) ? 1.8 : 1.0;
            if (pIdx == self.activeNodeIndex) {
                [[NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:0.85] setStroke];
            } else {
                [[NSColor colorWithWhite:1.0 alpha:0.20] setStroke];
            }
            [edgeL stroke];

            NSBezierPath *edgeR = [NSBezierPath bezierPath];
            [edgeR moveToPoint:pts[pIdx]];
            [edgeR lineToPoint:pts[rIdx]];
            edgeR.lineWidth = (pIdx == self.activeNodeIndex) ? 1.8 : 1.0;
            if (pIdx == self.activeNodeIndex) {
                [[NSColor colorWithRed:1.0 green:0.70 blue:0.24 alpha:0.85] setStroke];
            } else {
                [[NSColor colorWithWhite:1.0 alpha:0.20] setStroke];
            }
            [edgeR stroke];
        }
        rowBase = nextBase;
    }

    // Draw 15 stage nodes
    int nIdx = 0;
    for (int r = 0; r < 5; r++) {
        for (int c = 0; c <= r; c++) {
            CGPoint p = pts[nIdx];
            BOOL isActive = (nIdx == self.activeNodeIndex);
            BOOL isPast = (r < activeRow);
            BOOL isLeftBranch = (nIdx == leftChild);
            BOOL isRightBranch = (nIdx == rightChild);

            CGFloat rad = isActive ? 4.2 : 2.8;
            if (isActive) {
                NSRect glowRect = NSMakeRect(p.x - 6.8, p.y - 6.8, 13.6, 13.6);
                NSBezierPath *glow = [NSBezierPath bezierPathWithOvalInRect:glowRect];
                [[NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:0.32] setFill];
                [glow fill];
            }
            NSRect nodeRect = NSMakeRect(p.x - rad, p.y - rad, rad * 2.0, rad * 2.0);
            NSBezierPath *circle = [NSBezierPath bezierPathWithOvalInRect:nodeRect];
            if (isActive) {
                [[NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0] setFill];
            } else if (isLeftBranch) {
                [[NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:0.95] setFill];
            } else if (isRightBranch) {
                [[NSColor colorWithRed:1.0 green:0.68 blue:0.20 alpha:0.95] setFill];
            } else if (isPast) {
                [[NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:0.65] setFill];
            } else {
                [[NSColor colorWithWhite:1.0 alpha:0.26] setFill];
            }
            [circle fill];
            nIdx++;
        }
    }
}

@end

// Custom MTKView subclass that accepts keyboard events for driving
@interface ApexMetalView : MTKView
@property (nonatomic, assign) uint32_t seat0Mask;
@property (nonatomic, assign) uint32_t seat1Mask;
@property (nonatomic, assign) uint32_t latchedSeat0Mask;
@property (nonatomic, assign) uint32_t latchedSeat1Mask;
@property (nonatomic, assign) int32_t manualGearMode; // 0 = auto, 1 = low, 2 = high
@property (nonatomic, copy) void (^onControlAction)(NSString *action, float value);
@end

@implementation ApexMetalView

- (BOOL)acceptsFirstResponder {
    return YES;
}

- (void)handleKey:(NSEvent *)event isDown:(BOOL)isDown {
    unsigned short kc = event.keyCode;
    uint32_t bit0 = 0;
    uint32_t bit1 = 0;

    switch (kc) {
        case 13: // W
            bit0 = (1 << 0);
            break;
        case 126: // Up Arrow
            bit0 = (1 << 0);
            bit1 = (1 << 0);
            break;
        case 1: // S
            bit0 = (1 << 1);
            break;
        case 125: // Down Arrow
            bit0 = (1 << 1);
            bit1 = (1 << 1);
            break;
        case 0: // A
            bit0 = (1 << 2);
            break;
        case 123: // Left Arrow
            bit0 = (1 << 2);
            bit1 = (1 << 2);
            break;
        case 2: // D
            bit0 = (1 << 3);
            break;
        case 124: // Right Arrow
            bit0 = (1 << 3);
            bit1 = (1 << 3);
            break;
        case 6:  // Z
        case 56: // Left Shift
        case 60: // Right Shift
            bit0 = (1 << 4); // Drift
            break;
        case 49: // Space
        case 7:  // X
            bit0 = (1 << 5); // Nitro
            break;
        case 36: // Return / Enter
        case 76: // Keypad Enter
            bit0 = (1 << 6); // Enter
            if (isDown && !event.isARepeat && self.onControlAction) {
                self.onControlAction(@"enter-key", 0.0f);
            }
            break;
        case 53: // Escape
            if (isDown && !event.isARepeat && self.onControlAction) {
                self.onControlAction(@"toggle-pause", 0.0f);
            }
            break;
        case 19: // '2' key -> start 2P duel
            if (isDown && !event.isARepeat && self.onControlAction) {
                self.onControlAction(@"start-duel", 0.0f);
            }
            break;
        case 5: // 'G' key -> toggle LO/HI gear
            if (isDown && !event.isARepeat) {
                self.manualGearMode = (self.manualGearMode == 2) ? 1 : 2;
            }
            break;
        case 15: // 'R' key -> cycle radio station
            if (isDown && !event.isARepeat && self.onControlAction) {
                self.onControlAction(@"cycle-station", 0.0f);
            }
            break;
        case 46: // 'M' key -> toggle mute
            if (isDown && !event.isARepeat && self.onControlAction) {
                self.onControlAction(@"toggle-mute", 0.0f);
            }
            break;
        default:
            break;
    }

    if (bit0 != 0) {
        if (isDown) {
            self.seat0Mask |= bit0;
            self.latchedSeat0Mask |= bit0;
        } else {
            self.seat0Mask &= ~bit0;
        }
    }
    if (bit1 != 0) {
        if (isDown) {
            self.seat1Mask |= bit1;
            self.latchedSeat1Mask |= bit1;
        } else {
            self.seat1Mask &= ~bit1;
        }
    }
}

- (void)keyDown:(NSEvent *)event {
    [self handleKey:event isDown:YES];
}

- (void)keyUp:(NSEvent *)event {
    [self handleKey:event isDown:NO];
}

- (void)flagsChanged:(NSEvent *)event {
    BOOL shiftHeld = (event.modifierFlags & NSEventModifierFlagShift) != 0;
    if (shiftHeld) {
        self.seat0Mask |= (1 << 4);
        self.latchedSeat0Mask |= (1 << 4);
    } else {
        self.seat0Mask &= ~(1 << 4);
    }
}

@end

// Main AppKit + Metal + JavaScriptCore Controller
@interface ApexAppDelegate : NSObject <NSApplicationDelegate, MTKViewDelegate> {
    float _latestPose[186];
}
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) ApexMetalView *metalView;
@property (nonatomic, strong) id<MTLDevice> device;
@property (nonatomic, strong) id<MTLCommandQueue> commandQueue;
@property (nonatomic, strong) id<MTLRenderPipelineState> skyPipeline;
@property (nonatomic, strong) id<MTLRenderPipelineState> stagePipeline;
@property (nonatomic, strong) id<MTLDepthStencilState> skyDepthState;
@property (nonatomic, strong) id<MTLDepthStencilState> stageDepthState;
@property (nonatomic, strong) id<MTLBuffer> staticVertexBuffer;
@property (nonatomic, strong) id<MTLBuffer> staticIndexBuffer;
@property (nonatomic, assign) NSUInteger staticIndexCount;
@property (nonatomic, strong) id<MTLTexture> fallbackTexture;
@property (nonatomic, strong) id<MTLTexture> skyTexture;
@property (nonatomic, strong) id<MTLTexture> farBackdropTexture;
@property (nonatomic, strong) id<MTLTexture> midBackdropTexture;
@property (nonatomic, strong) id<MTLTexture> groundTexture;
@property (nonatomic, strong) id<MTLSamplerState> skySampler;
@property (nonatomic, strong) id<MTLSamplerState> groundSampler;
@property (nonatomic, strong) NSMutableDictionary<NSString *, id<MTLTexture>> *textureCache;

// JavaScriptCore context & cached references
@property (nonatomic, assign) JSGlobalContextRef jsCtx;
@property (nonatomic, assign) JSObjectRef jsNativeObj;
@property (nonatomic, assign) JSObjectRef jsStepFn;
@property (nonatomic, assign) JSObjectRef jsInitFn;
@property (nonatomic, assign) JSObjectRef jsInitStageFn;
@property (nonatomic, assign) JSObjectRef jsBuildGlbFn;
@property (nonatomic, assign) JSObjectRef jsPoseArrayObj;
@property (nonatomic, copy) NSString *currentStageId;
@property (nonatomic, assign) MacHudSnapshotC latestHud;
@property (nonatomic, copy) NSString *autodriveScreenshotDir;
@property (nonatomic, assign) int autodriveShotIndex;
@property (nonatomic, assign) int autodriveWarmupLeft;

// Winio AppKit Slow HUD controls translated from compiled `arena_winio.json` (`arena.html` + `arena.css` + `hud.js`)
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *winioSpecById;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *winioSpecByLayer;

@property (nonatomic, strong) NSTextField *stageLabel;
@property (nonatomic, strong) NSTextField *checkpointPillLabel;
@property (nonatomic, strong) NSTextField *driftLabel;
@property (nonatomic, strong) NSTextField *forkDistLabel;
@property (nonatomic, strong) NSView *routeProgressFillView;

@property (nonatomic, strong) NSTextField *timerLabel;
@property (nonatomic, strong) NSTextField *timerDecLabel;
@property (nonatomic, strong) NSTextField *rivalHeaderLabel;
@property (nonatomic, strong) NSTextField *rivalGapLabel;
@property (nonatomic, strong) NSView *rivalFillView;
@property (nonatomic, strong) NSTextField *scoreLabel;

@property (nonatomic, strong) NSTextField *matrixForkLabel;
@property (nonatomic, strong) ApexRouteMatrixView *routeMatrixView;
@property (nonatomic, strong) NSTextField *branchLeftLabel;
@property (nonatomic, strong) NSTextField *branchRightLabel;
@property (nonatomic, strong) NSTextField *stationLabel;
@property (nonatomic, strong) NSButton *muteButton;
@property (nonatomic, strong) NSMutableArray<NSView *> *eqBarViews;

@property (nonatomic, strong) NSTextField *radarLabel;
@property (nonatomic, strong) NSTextField *rivalSplitLabel;
@property (nonatomic, strong) NSTextField *gforceLabel;
@property (nonatomic, strong) NSTextField *slipstreamLabel;
@property (nonatomic, strong) NSMutableArray<NSView *> *draftSegViews;

@property (nonatomic, strong) NSTextField *surfacePillLabel;

@property (nonatomic, strong) NSTextField *veloModeLabel;
@property (nonatomic, strong) NSTextField *speedLabel;
@property (nonatomic, strong) NSTextField *gearLowPill;
@property (nonatomic, strong) NSTextField *gearHighPill;
@property (nonatomic, strong) NSTextField *rpmLabel;
@property (nonatomic, strong) NSMutableArray<NSView *> *tachoSegmentViews;
@property (nonatomic, strong) NSTextField *nitroTextLabel;
@property (nonatomic, strong) NSView *nitroFillView;

@property (nonatomic, strong) NSTextField *bannerLabel;

// Modal overlay cards controlled by WinioDesktopApp CSS state rules
@property (nonatomic, strong) NSVisualEffectView *titleCard;
@property (nonatomic, strong) NSVisualEffectView *pauseCard;
@property (nonatomic, strong) NSVisualEffectView *resultCard;
@property (nonatomic, strong) NSTextField *resultSummaryLabel;
@end

static NSTextField *makeHudLabel(NSString *text, CGFloat size, NSFontWeight weight, NSColor *color, NSTextAlignment align) {
    NSTextField *lbl = [NSTextField labelWithString:text ?: @""];
    lbl.font = [NSFont monospacedSystemFontOfSize:size weight:weight];
    lbl.textColor = color;
    lbl.alignment = align;
    lbl.backgroundColor = [NSColor clearColor];
    lbl.bordered = NO;
    lbl.editable = NO;
    lbl.selectable = NO;
    lbl.refusesFirstResponder = YES;
    return lbl;
}

static NSVisualEffectView *makeHudPanel(NSRect frame, CGFloat cornerRadius) {
    NSVisualEffectView *panel = [[NSVisualEffectView alloc] initWithFrame:frame];
    panel.appearance = [NSAppearance appearanceNamed:NSAppearanceNameVibrantDark];
    panel.material = NSVisualEffectMaterialHUDWindow;
    panel.blendingMode = NSVisualEffectBlendingModeWithinWindow;
    panel.state = NSVisualEffectStateActive;
    panel.wantsLayer = YES;
    panel.layer.backgroundColor = [NSColor colorWithRed:0.06 green:0.08 blue:0.13 alpha:0.84].CGColor;
    panel.layer.cornerRadius = cornerRadius;
    panel.layer.masksToBounds = YES;
    panel.layer.borderWidth = 1.0;
    panel.layer.borderColor = [NSColor colorWithWhite:1.0 alpha:0.16].CGColor;
    return panel;
}

static NSButton *makeHudButton(NSString *title, id target, SEL action, NSRect frame, NSColor *accent) {
    NSButton *btn = [[NSButton alloc] initWithFrame:frame];
    btn.title = title;
    btn.target = target;
    btn.action = action;
    btn.bezelStyle = NSBezelStyleRegularSquare;
    btn.bordered = NO;
    btn.refusesFirstResponder = YES;
    btn.wantsLayer = YES;
    btn.layer.backgroundColor = [accent colorWithAlphaComponent:0.88].CGColor;
    btn.layer.cornerRadius = 8.0;
    btn.layer.borderWidth = 1.0;
    btn.layer.borderColor = [NSColor colorWithWhite:1.0 alpha:0.25].CGColor;
    NSMutableAttributedString *attr = [[NSMutableAttributedString alloc] initWithString:title attributes:@{
        NSFontAttributeName: [NSFont monospacedSystemFontOfSize:12.0 weight:NSFontWeightBold],
        NSForegroundColorAttributeName: [NSColor whiteColor]
    }];
    [attr setAlignment:NSTextAlignmentCenter range:NSMakeRange(0, attr.length)];
    btn.attributedTitle = attr;
    return btn;
}

static void indexWinioWidgetNode(
    NSDictionary *node,
    NSMutableDictionary<NSString *, NSDictionary *> *byId,
    NSMutableDictionary<NSString *, NSDictionary *> *byLayer
) {
    if (![node isKindOfClass:[NSDictionary class]]) {
        return;
    }
    NSString *wid = node[@"id"];
    if ([wid isKindOfClass:[NSString class]] && wid.length > 0) {
        byId[wid] = node;
    }
    NSString *hudLayer = node[@"hudLayer"];
    if ([hudLayer isKindOfClass:[NSString class]] && hudLayer.length > 0) {
        byLayer[hudLayer] = node;
    }
    NSDictionary *attrs = node[@"attrs"];
    if ([attrs isKindOfClass:[NSDictionary class]]) {
        NSString *layer = attrs[@"data-layer"];
        if ([layer isKindOfClass:[NSString class]] && layer.length > 0) {
            byLayer[layer] = node;
        }
    }
    NSArray *children = node[@"children"];
    if ([children isKindOfClass:[NSArray class]]) {
        for (id child in children) {
            indexWinioWidgetNode(child, byId, byLayer);
        }
    }
}

@implementation ApexAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    const char *sim_js_ptr = NULL;
    size_t sim_js_len = 0;
    if (!apexrun_rust_init(&sim_js_ptr, &sim_js_len)) {
        NSLog(@"Failed to initialize OmnishellDesktopHost");
        [NSApp terminate:nil];
        return;
    }

    self.currentStageId = @"coconut-beach";
    self.autodriveScreenshotDir = [[[NSProcessInfo processInfo] environment] objectForKey:@"APEXRUN_SCREENSHOT_DIR"];
    [self loadCompiledWinioScreenSpec];
    [self setupJavaScriptCoreWithSource:sim_js_ptr length:sim_js_len];
    [self setupWindowAndMetal];
    [self uploadStaticStageBuffers];
    [self setupWinioHudOverlay];
    start_coreaudio_stream();

    // Install local NSEvent key monitor so Space (49), X (7), and driving keys always reach ApexMetalView
    // and are never swallowed by AppKit NSButton performClick: or focus rings.
    __weak typeof(self) weakSelf = self;
    [NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskFlagsChanged)
                                          handler:^NSEvent * _Nullable(NSEvent * _Nonnull event) {
        ApexAppDelegate *strongSelf = weakSelf;
        if (!strongSelf || !strongSelf.metalView) {
            return event;
        }
        if (event.type == NSEventTypeFlagsChanged) {
            [strongSelf.metalView flagsChanged:event];
            return event;
        }
        unsigned short kc = event.keyCode;
        BOOL isGameKey = (kc == 49 || kc == 7 || kc == 13 || kc == 1 || kc == 0 || kc == 2 ||
                          kc == 126 || kc == 125 || kc == 123 || kc == 124 || kc == 6 ||
                          kc == 36 || kc == 76 || kc == 53 || kc == 19 || kc == 5 || kc == 15 || kc == 46);
        if (isGameKey) {
            [strongSelf.metalView handleKey:event isDown:(event.type == NSEventTypeKeyDown)];
            return nil;
        }
        return event;
    }];

    // Step one initial frame so camera PoseBuffer and HUD are populated immediately
    [self stepSimulationFrameWithAspect:1280.0f / 800.0f];

    if (self.autodriveScreenshotDir.length > 0) {
        self.autodriveShotIndex = 0;
        [self prepareAutodriveShot:0 aspect:1280.0f / 800.0f];
    }

    [NSApp activateIgnoringOtherApps:YES];
    [self.window makeKeyAndOrderFront:nil];
    [self.window makeFirstResponder:self.metalView];
}

- (void)loadCompiledWinioScreenSpec {
    self.winioSpecById = [NSMutableDictionary dictionary];
    self.winioSpecByLayer = [NSMutableDictionary dictionary];
    const char *json_ptr = NULL;
    size_t json_len = 0;
    apexrun_rust_get_winio_spec_json(&json_ptr, &json_len);
    if (!json_ptr || json_len == 0) {
        return;
    }
    NSData *data = [NSData dataWithBytesNoCopy:(void *)json_ptr length:json_len freeWhenDone:NO];
    NSDictionary *spec = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if ([spec isKindOfClass:[NSDictionary class]]) {
        indexWinioWidgetNode(spec[@"root"], self.winioSpecById, self.winioSpecByLayer);
    }
}

- (NSString *)winioTextForId:(NSString *)wid fallback:(NSString *)fallback {
    NSDictionary *node = self.winioSpecById[wid];
    NSString *t = node[@"text"];
    return ([t isKindOfClass:[NSString class]] && t.length > 0) ? t : fallback;
}

- (NSString *)winioTextForLayer:(NSString *)layer fallback:(NSString *)fallback {
    NSDictionary *node = self.winioSpecByLayer[layer];
    NSString *t = node[@"text"];
    return ([t isKindOfClass:[NSString class]] && t.length > 0) ? t : fallback;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    (void)sender;
    return YES;
}

- (void)setupJavaScriptCoreWithSource:(const char *)src length:(size_t)len {
    self.jsCtx = JSGlobalContextCreate(NULL);
    NSString *nsSrc = [[NSString alloc] initWithBytes:src length:len encoding:NSUTF8StringEncoding];
    JSStringRef scriptStr = JSStringCreateWithCFString((__bridge CFStringRef)nsSrc);
    JSValueRef exc = NULL;
    JSEvaluateScript(self.jsCtx, scriptStr, NULL, NULL, 1, &exc);
    JSStringRelease(scriptStr);
    apexAssertNoJsException(self.jsCtx, exc, "JSEvaluateScript(sim_bundle)");

    JSObjectRef globalObj = JSContextGetGlobalObject(self.jsCtx);

    JSStringRef nativeProp = JSStringCreateWithUTF8CString("__apexrunNative");
    self.jsNativeObj = JSValueToObject(self.jsCtx, JSObjectGetProperty(self.jsCtx, globalObj, nativeProp, NULL), NULL);
    JSStringRelease(nativeProp);

    JSStringRef stepProp = JSStringCreateWithUTF8CString("step");
    self.jsStepFn = JSValueToObject(self.jsCtx, JSObjectGetProperty(self.jsCtx, self.jsNativeObj, stepProp, NULL), NULL);
    JSStringRelease(stepProp);

    JSStringRef initProp = JSStringCreateWithUTF8CString("init");
    self.jsInitFn = JSValueToObject(self.jsCtx, JSObjectGetProperty(self.jsCtx, self.jsNativeObj, initProp, NULL), NULL);
    JSStringRelease(initProp);

    JSStringRef initStageProp = JSStringCreateWithUTF8CString("initStage");
    self.jsInitStageFn = JSValueToObject(self.jsCtx, JSObjectGetProperty(self.jsCtx, self.jsNativeObj, initStageProp, NULL), NULL);
    JSStringRelease(initStageProp);

    JSStringRef buildGlbProp = JSStringCreateWithUTF8CString("buildStageGlb");
    self.jsBuildGlbFn = JSValueToObject(self.jsCtx, JSObjectGetProperty(self.jsCtx, self.jsNativeObj, buildGlbProp, NULL), NULL);
    JSStringRelease(buildGlbProp);

    JSStringRef poseProp = JSStringCreateWithUTF8CString("__apexrunPoseArray");
    self.jsPoseArrayObj = JSValueToObject(self.jsCtx, JSObjectGetProperty(self.jsCtx, globalObj, poseProp, NULL), NULL);
    JSStringRelease(poseProp);
}

- (void)resetJsSimulationForDuel:(BOOL)isDuel stageState:(NSString *)stageState {
    JSValueRef args[3];
    args[0] = JSValueMakeNumber(self.jsCtx, 0x1337);
    args[1] = JSValueMakeBoolean(self.jsCtx, isDuel);
    JSStringRef stateStr = JSStringCreateWithCFString((__bridge CFStringRef)stageState);
    args[2] = JSValueMakeString(self.jsCtx, stateStr);
    JSValueRef exc = NULL;
    JSObjectCallAsFunction(self.jsCtx, self.jsInitFn, self.jsNativeObj, 3, args, &exc);
    JSStringRelease(stateStr);
    apexAssertNoJsException(self.jsCtx, exc, "__apexrunNative.init");
    self.metalView.manualGearMode = 0;

    if (![self.currentStageId isEqualToString:@"coconut-beach"]) {
        self.currentStageId = @"coconut-beach";
        [self rebuildAndUploadStage:@"coconut-beach"];
    }
}

- (void)rebuildAndUploadStage:(NSString *)stageId {
    [self updateStageEnvironmentTextures:stageId];
    JSStringRef stageStr = JSStringCreateWithCFString((__bridge CFStringRef)stageId);
    JSValueRef arg = JSValueMakeString(self.jsCtx, stageStr);
    JSValueRef exc = NULL;
    JSValueRef lenVal = JSObjectCallAsFunction(self.jsCtx, self.jsBuildGlbFn, self.jsNativeObj, 1, &arg, &exc);
    JSStringRelease(stageStr);
    apexAssertNoJsException(self.jsCtx, exc, "__apexrunNative.buildStageGlb");
    double rawLen = JSValueToNumber(self.jsCtx, lenVal, &exc);
    apexAssertNoJsException(self.jsCtx, exc, "buildStageGlb length");
    size_t byteLen = (rawLen > 0.0 && isfinite(rawLen)) ? (size_t)rawLen : 0;
    if (byteLen > 0) {
        JSObjectRef globalObj = JSContextGetGlobalObject(self.jsCtx);
        JSStringRef glbProp = JSStringCreateWithUTF8CString("__apexrunStageGlb");
        JSObjectRef glbArr = JSValueToObject(self.jsCtx, JSObjectGetProperty(self.jsCtx, globalObj, glbProp, &exc), &exc);
        JSStringRelease(glbProp);
        apexAssertNoJsException(self.jsCtx, exc, "__apexrunStageGlb");
        size_t backingLen = JSObjectGetTypedArrayByteLength(self.jsCtx, glbArr, &exc);
        apexAssertNoJsException(self.jsCtx, exc, "__apexrunStageGlb byteLength");
        const uint8_t *bytesPtr = (const uint8_t *)JSObjectGetTypedArrayBytesPtr(self.jsCtx, glbArr, &exc);
        apexAssertNoJsException(self.jsCtx, exc, "__apexrunStageGlb bytesPtr");
        if (!bytesPtr || byteLen > backingLen) {
            [NSException raise:@"ApexRunStageGlbException" format:@"Invalid stage GLB buffer (%zu > %zu)", byteLen, backingLen];
        }
        if (!apexrun_rust_load_stage_glb(bytesPtr, byteLen)) {
            [NSException raise:@"ApexRunStageGlbException" format:@"Failed to load stage GLB for %@", stageId];
        }
        [self uploadStaticStageBuffers];
    }
}

- (id<MTLTexture>)loadSeedTexture:(NSString *)fileName {
    if (!self.textureCache) {
        self.textureCache = [NSMutableDictionary dictionary];
    }
    return apexLoadSeedTexture(self.device, self.textureCache, fileName);
}

- (void)updateStageEnvironmentTextures:(NSString *)stageId {
    StagePaletteC pal = stagePaletteForId(stageId ?: @"coconut-beach");
    self.skyTexture = [self loadSeedTexture:[NSString stringWithUTF8String:pal.sky_file]];
    self.farBackdropTexture = [self loadSeedTexture:[NSString stringWithUTF8String:pal.far_file]];
    self.midBackdropTexture = [self loadSeedTexture:[NSString stringWithUTF8String:pal.mid_file]];
    self.groundTexture = [self loadSeedTexture:[NSString stringWithUTF8String:pal.ground_file]];
}

- (void)setupWindowAndMetal {
    NSRect rect = NSMakeRect(0, 0, 1280, 800);
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
    self.window = [[NSWindow alloc] initWithContentRect:rect styleMask:style backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"Apex OutRun — Kinetic Native macOS (Bevy Metal + Winio AppKit)";
    self.window.minSize = NSMakeSize(960, 640);
    [self.window center];

    self.device = MTLCreateSystemDefaultDevice();
    self.commandQueue = [self.device newCommandQueue];

    self.metalView = [[ApexMetalView alloc] initWithFrame:rect device:self.device];
    self.metalView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.metalView.colorPixelFormat = MTLPixelFormatBGRA8Unorm;
    self.metalView.depthStencilPixelFormat = MTLPixelFormatDepth32Float;
    self.metalView.sampleCount = (self.autodriveScreenshotDir.length > 0) ? 1 : 4;
    if (self.autodriveScreenshotDir.length > 0) {
        self.metalView.framebufferOnly = NO;
    }
    self.metalView.preferredFramesPerSecond = 60;
    self.metalView.delegate = self;

    __weak typeof(self) weakSelf = self;
    self.metalView.onControlAction = ^(NSString *action, float value) {
        [weakSelf dispatchWinioAction:action value:value];
    };

    self.window.contentView = self.metalView;

    apexSetupMetalPipelines(
        self.device,
        self.metalView,
        &_skyPipeline,
        &_skyDepthState,
        &_stagePipeline,
        &_stageDepthState,
        &_skySampler,
        &_groundSampler,
        &_fallbackTexture
    );

    [self updateStageEnvironmentTextures:self.currentStageId];
}

- (void)uploadStaticStageBuffers {
    const GpuVertexC *verts = NULL;
    size_t vertCount = 0;
    const uint32_t *indices = NULL;
    size_t indexCount = 0;
    apexrun_rust_get_static_mesh(&verts, &vertCount, &indices, &indexCount);
    if (verts && vertCount > 0 && indices && indexCount > 0) {
        self.staticVertexBuffer = [self.device newBufferWithBytes:verts
                                                           length:vertCount * sizeof(GpuVertexC)
                                                          options:MTLResourceStorageModeShared];
        self.staticIndexBuffer = [self.device newBufferWithBytes:indices
                                                          length:indexCount * sizeof(uint32_t)
                                                         options:MTLResourceStorageModeShared];
        self.staticIndexCount = indexCount;
    }
}

- (void)setupWinioHudOverlay {
    NSView *root = self.metalView;
    CGFloat W = root.bounds.size.width;
    CGFloat H = root.bounds.size.height;

    // 1. Top-Left: Stage & Route Progress Card (translated from `.hud-tl` in `arena_winio.json`)
    NSVisualEffectView *topLeft = makeHudPanel(NSMakeRect(20, H - 132, 356, 112), 12.0);
    topLeft.autoresizingMask = NSViewMaxXMargin | NSViewMinYMargin;
    self.stageLabel = makeHudLabel(
        [self winioTextForId:@"stk-track-name" fallback:@"STAGE 1 · COCONUT BEACH"],
        12.5, NSFontWeightHeavy, [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0], NSTextAlignmentLeft
    );
    self.stageLabel.frame = NSMakeRect(14, 82, 218, 20);

    self.checkpointPillLabel = makeHudLabel(@"CHECKPOINT A-1", 9.0, NSFontWeightHeavy, [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0], NSTextAlignmentCenter);
    self.checkpointPillLabel.frame = NSMakeRect(234, 83, 108, 18);
    self.checkpointPillLabel.wantsLayer = YES;
    self.checkpointPillLabel.layer.backgroundColor = [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:0.16].CGColor;
    self.checkpointPillLabel.layer.cornerRadius = 4.0;

    NSTextField *driftHdr = makeHudLabel(@"DRIFT CHARGE", 9.0, NSFontWeightBold, [NSColor colorWithWhite:0.65 alpha:1.0], NSTextAlignmentLeft);
    driftHdr.frame = NSMakeRect(14, 58, 160, 13);
    NSTextField *forkHdr = makeHudLabel(@"NEXT FORK", 9.0, NSFontWeightBold, [NSColor colorWithWhite:0.65 alpha:1.0], NSTextAlignmentRight);
    forkHdr.frame = NSMakeRect(200, 58, 142, 13);

    self.driftLabel = makeHudLabel(
        [self winioTextForLayer:@"drift" fallback:@"TRACTION: NOMINAL"],
        11.5, NSFontWeightBold, [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0], NSTextAlignmentLeft
    );
    self.driftLabel.frame = NSMakeRect(14, 38, 200, 18);

    self.forkDistLabel = makeHudLabel(
        [self winioTextForLayer:@"fork-dist" fallback:@"850 m"],
        11.5, NSFontWeightHeavy, [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0], NSTextAlignmentRight
    );
    self.forkDistLabel.frame = NSMakeRect(214, 38, 128, 18);

    NSTextField *routeBarLbl = makeHudLabel(@"STAGE PROGRESS", 8.5, NSFontWeightBold, [NSColor colorWithWhite:0.62 alpha:1.0], NSTextAlignmentLeft);
    routeBarLbl.frame = NSMakeRect(14, 21, 140, 12);

    NSView *routeBg = [[NSView alloc] initWithFrame:NSMakeRect(14, 10, 328, 8)];
    routeBg.wantsLayer = YES;
    routeBg.layer.backgroundColor = [NSColor colorWithWhite:1.0 alpha:0.14].CGColor;
    routeBg.layer.cornerRadius = 4.0;
    self.routeProgressFillView = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 10, 8)];
    self.routeProgressFillView.wantsLayer = YES;
    self.routeProgressFillView.layer.backgroundColor = [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0].CGColor;
    self.routeProgressFillView.layer.cornerRadius = 4.0;
    [routeBg addSubview:self.routeProgressFillView];

    [topLeft addSubview:self.stageLabel];
    [topLeft addSubview:self.checkpointPillLabel];
    [topLeft addSubview:driftHdr];
    [topLeft addSubview:forkHdr];
    [topLeft addSubview:self.driftLabel];
    [topLeft addSubview:self.forkDistLabel];
    [topLeft addSubview:routeBarLbl];
    [topLeft addSubview:routeBg];
    [root addSubview:topLeft];

    // 2. Top-Center: Score, Timer + Decimal, and Rival Gap (translated from `.hud-tc` in `arena_winio.json`)
    NSVisualEffectView *topCenter = makeHudPanel(NSMakeRect((W - 430) * 0.5, H - 124, 430, 104), 12.0);
    topCenter.autoresizingMask = NSViewMinXMargin | NSViewMaxXMargin | NSViewMinYMargin;

    NSTextField *scoreHdr = makeHudLabel(@"SCORE", 9.5, NSFontWeightBold, [NSColor colorWithWhite:0.68 alpha:1.0], NSTextAlignmentLeft);
    scoreHdr.frame = NSMakeRect(16, 76, 110, 14);
    self.scoreLabel = makeHudLabel(
        [self winioTextForLayer:@"score" fallback:@"0000000"],
        22.0, NSFontWeightHeavy, [NSColor whiteColor], NSTextAlignmentLeft
    );
    self.scoreLabel.frame = NSMakeRect(16, 44, 128, 28);
    NSTextField *ptsUnit = makeHudLabel(@"PTS", 10.0, NSFontWeightBold, [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0], NSTextAlignmentLeft);
    ptsUnit.frame = NSMakeRect(16, 24, 60, 14);

    NSTextField *timeHdr = makeHudLabel(@"TIME REMAINING", 9.5, NSFontWeightBold, [NSColor colorWithWhite:0.72 alpha:1.0], NSTextAlignmentCenter);
    timeHdr.frame = NSMakeRect(145, 78, 140, 14);
    self.timerLabel = makeHudLabel(
        [self winioTextForLayer:@"timer" fallback:@"75"],
        40.0, NSFontWeightHeavy, [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0], NSTextAlignmentRight
    );
    self.timerLabel.frame = NSMakeRect(145, 30, 78, 44);
    self.timerDecLabel = makeHudLabel(
        [self winioTextForLayer:@"timer-dec" fallback:@".0"],
        22.0, NSFontWeightHeavy, [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:0.90], NSTextAlignmentLeft
    );
    self.timerDecLabel.frame = NSMakeRect(224, 34, 48, 28);
    NSTextField *secUnit = makeHudLabel(@"SEC", 9.5, NSFontWeightBold, [NSColor colorWithWhite:0.65 alpha:1.0], NSTextAlignmentCenter);
    secUnit.frame = NSMakeRect(175, 12, 80, 14);

    self.rivalHeaderLabel = makeHudLabel(@"RIVAL GAP", 9.5, NSFontWeightBold, [NSColor colorWithRed:1.0 green:0.20 blue:0.40 alpha:1.0], NSTextAlignmentRight);
    self.rivalHeaderLabel.frame = NSMakeRect(290, 76, 124, 14);
    self.rivalGapLabel = makeHudLabel(
        [self winioTextForLayer:@"rival-gap" fallback:@"120 m"],
        20.0, NSFontWeightHeavy, [NSColor colorWithRed:1.0 green:0.20 blue:0.40 alpha:1.0], NSTextAlignmentRight
    );
    self.rivalGapLabel.frame = NSMakeRect(290, 44, 124, 26);

    NSView *rivalBg = [[NSView alloc] initWithFrame:NSMakeRect(294, 24, 120, 7)];
    rivalBg.wantsLayer = YES;
    rivalBg.layer.backgroundColor = [NSColor colorWithWhite:1.0 alpha:0.15].CGColor;
    rivalBg.layer.cornerRadius = 3.5;
    self.rivalFillView = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 30, 7)];
    self.rivalFillView.wantsLayer = YES;
    self.rivalFillView.layer.backgroundColor = [NSColor colorWithRed:1.0 green:0.20 blue:0.40 alpha:1.0].CGColor;
    self.rivalFillView.layer.cornerRadius = 3.5;
    [rivalBg addSubview:self.rivalFillView];

    [topCenter addSubview:scoreHdr];
    [topCenter addSubview:self.scoreLabel];
    [topCenter addSubview:ptsUnit];
    [topCenter addSubview:timeHdr];
    [topCenter addSubview:self.timerLabel];
    [topCenter addSubview:self.timerDecLabel];
    [topCenter addSubview:secUnit];
    [topCenter addSubview:self.rivalHeaderLabel];
    [topCenter addSubview:self.rivalGapLabel];
    [topCenter addSubview:rivalBg];
    [root addSubview:topCenter];

    // Center Moment Banner ("3", "2", "1", "GO!", "GOAL!", "STAGE 1 · COCONUT BEACH", "STAGE 1 CLEAR · EXTENDED PLAY +45s")
    self.bannerLabel = makeHudLabel(@"", 64.0, NSFontWeightHeavy, [NSColor colorWithRed:1.0 green:0.92 blue:0.32 alpha:1.0], NSTextAlignmentCenter);
    self.bannerLabel.frame = NSMakeRect((W - 760) * 0.5, H * 0.54, 760, 84);
    self.bannerLabel.autoresizingMask = NSViewMinXMargin | NSViewMaxXMargin | NSViewMinYMargin | NSViewMaxYMargin;
    [root addSubview:self.bannerLabel];

    // 3. Top-Right: 15-Node SEGA ROUTE MATRIX Pyramid + Coastline Radio + 6-band EQ (`.hud-tr` in `arena_winio.json`)
    NSVisualEffectView *topRight = makeHudPanel(NSMakeRect(W - 376, H - 208, 356, 188), 12.0);
    topRight.autoresizingMask = NSViewMinXMargin | NSViewMinYMargin;
    NSTextField *matrixHdr = makeHudLabel(@"SEGA ROUTE MATRIX", 10.0, NSFontWeightBold, [NSColor colorWithWhite:0.72 alpha:1.0], NSTextAlignmentLeft);
    matrixHdr.frame = NSMakeRect(14, 166, 150, 14);
    self.matrixForkLabel = makeHudLabel(
        [self winioTextForLayer:@"matrix-fork" fallback:@"FORK IN 850M"],
        10.5, NSFontWeightHeavy, [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0], NSTextAlignmentRight
    );
    self.matrixForkLabel.frame = NSMakeRect(166, 166, 176, 14);

    self.routeMatrixView = [[ApexRouteMatrixView alloc] initWithFrame:NSMakeRect(14, 102, 328, 60)];
    self.routeMatrixView.activeNodeIndex = 0;

    self.branchLeftLabel = makeHudLabel(@"◀ [L] DESERT CANYONS", 10.0, NSFontWeightBold, [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0], NSTextAlignmentLeft);
    self.branchLeftLabel.frame = NSMakeRect(14, 84, 162, 15);
    self.branchRightLabel = makeHudLabel(@"[R] GATEWAY PASS ▶", 10.0, NSFontWeightBold, [NSColor colorWithRed:1.0 green:0.72 blue:0.24 alpha:1.0], NSTextAlignmentRight);
    self.branchRightLabel.frame = NSMakeRect(180, 84, 162, 15);

    NSView *matrixDivider = [[NSView alloc] initWithFrame:NSMakeRect(14, 76, 328, 1)];
    matrixDivider.wantsLayer = YES;
    matrixDivider.layer.backgroundColor = [NSColor colorWithWhite:1.0 alpha:0.12].CGColor;

    NSTextField *radioHdr = makeHudLabel(@"COASTLINE RADIO", 9.5, NSFontWeightBold, [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0], NSTextAlignmentLeft);
    radioHdr.frame = NSMakeRect(14, 56, 210, 14);
    self.stationLabel = makeHudLabel(
        [self winioTextForId:@"stk-radio-station" fallback:@"FM 88.5 · MAGICAL SOUND SHOWER"],
        12.0, NSFontWeightBold, [NSColor whiteColor], NSTextAlignmentLeft
    );
    self.stationLabel.frame = NSMakeRect(14, 36, 224, 18);

    NSButton *nextStationBtn = makeHudButton(@"NEXT ⏭", self, @selector(onCycleStationClicked:), NSMakeRect(14, 8, 82, 24), [NSColor colorWithRed:0.20 green:0.46 blue:0.78 alpha:1.0]);
    self.muteButton = makeHudButton(@"🔊 MUTE", self, @selector(onMuteClicked:), NSMakeRect(102, 8, 78, 24), [NSColor colorWithWhite:0.28 alpha:1.0]);

    self.eqBarViews = [NSMutableArray arrayWithCapacity:6];
    for (int i = 0; i < 6; i++) {
        NSView *bar = [[NSView alloc] initWithFrame:NSMakeRect(245 + i * 16, 10, 11, 52)];
        bar.wantsLayer = YES;
        bar.layer.backgroundColor = [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:0.92].CGColor;
        bar.layer.cornerRadius = 3.0;
        [topRight addSubview:bar];
        [self.eqBarViews addObject:bar];
    }
    [topRight addSubview:matrixHdr];
    [topRight addSubview:self.matrixForkLabel];
    [topRight addSubview:self.routeMatrixView];
    [topRight addSubview:self.branchLeftLabel];
    [topRight addSubview:self.branchRightLabel];
    [topRight addSubview:matrixDivider];
    [topRight addSubview:radioHdr];
    [topRight addSubview:self.stationLabel];
    [topRight addSubview:nextStationBtn];
    [topRight addSubview:self.muteButton];
    [root addSubview:topRight];

    // 4. Bottom-Left: HIGHWAY TELEMETRY (Radar + Rival Split + G-Force + Slipstream + 4-Seg Draft Stream)
    NSVisualEffectView *botLeft = makeHudPanel(NSMakeRect(20, 20, 356, 134), 12.0);
    botLeft.autoresizingMask = NSViewMaxXMargin | NSViewMaxYMargin;
    NSTextField *teleHdr = makeHudLabel(@"HIGHWAY TELEMETRY", 10.0, NSFontWeightBold, [NSColor colorWithWhite:0.72 alpha:1.0], NSTextAlignmentLeft);
    teleHdr.frame = NSMakeRect(14, 108, 180, 14);
    NSButton *pauseBtn = makeHudButton(@"PAUSE [ESC]", self, @selector(onPauseClicked:), NSMakeRect(232, 100, 110, 26), [NSColor colorWithWhite:0.25 alpha:1.0]);

    NSTextField *radarKey = makeHudLabel(@"PROXIMITY RADAR", 9.0, NSFontWeightBold, [NSColor colorWithWhite:0.62 alpha:1.0], NSTextAlignmentLeft);
    radarKey.frame = NSMakeRect(14, 82, 120, 13);
    self.radarLabel = makeHudLabel(
        [self winioTextForLayer:@"radar" fallback:@"CLEAR"],
        11.5, NSFontWeightHeavy, [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0], NSTextAlignmentLeft
    );
    self.radarLabel.frame = NSMakeRect(136, 80, 104, 16);

    self.rivalSplitLabel = makeHudLabel(
        [self winioTextForLayer:@"rival-split" fallback:@"--"],
        11.0, NSFontWeightHeavy, [NSColor colorWithRed:1.0 green:0.20 blue:0.40 alpha:1.0], NSTextAlignmentRight
    );
    self.rivalSplitLabel.frame = NSMakeRect(236, 80, 106, 16);

    NSTextField *gfKey = makeHudLabel(@"LATERAL G-FORCE", 9.0, NSFontWeightBold, [NSColor colorWithWhite:0.62 alpha:1.0], NSTextAlignmentLeft);
    gfKey.frame = NSMakeRect(14, 58, 120, 13);
    self.gforceLabel = makeHudLabel(
        [self winioTextForLayer:@"gforce" fallback:@"0.0G"],
        11.5, NSFontWeightBold, [NSColor whiteColor], NSTextAlignmentLeft
    );
    self.gforceLabel.frame = NSMakeRect(136, 56, 120, 16);

    NSTextField *slipKey = makeHudLabel(@"SLIPSTREAM GAIN", 9.0, NSFontWeightBold, [NSColor colorWithWhite:0.62 alpha:1.0], NSTextAlignmentLeft);
    slipKey.frame = NSMakeRect(14, 34, 120, 13);
    self.slipstreamLabel = makeHudLabel(
        [self winioTextForLayer:@"slipstream" fallback:@"INACTIVE"],
        11.5, NSFontWeightBold, [NSColor colorWithWhite:0.70 alpha:1.0], NSTextAlignmentLeft
    );
    self.slipstreamLabel.frame = NSMakeRect(136, 32, 206, 16);

    NSTextField *draftKey = makeHudLabel(@"DRAFT STREAM", 9.0, NSFontWeightBold, [NSColor colorWithWhite:0.62 alpha:1.0], NSTextAlignmentLeft);
    draftKey.frame = NSMakeRect(14, 10, 110, 13);
    self.draftSegViews = [NSMutableArray arrayWithCapacity:4];
    for (int i = 0; i < 4; i++) {
        NSView *dseg = [[NSView alloc] initWithFrame:NSMakeRect(136 + i * 52, 12, 46, 8)];
        dseg.wantsLayer = YES;
        dseg.layer.cornerRadius = 2.0;
        dseg.layer.backgroundColor = [NSColor colorWithWhite:1.0 alpha:0.14].CGColor;
        [botLeft addSubview:dseg];
        [self.draftSegViews addObject:dseg];
    }

    [botLeft addSubview:teleHdr];
    [botLeft addSubview:pauseBtn];
    [botLeft addSubview:radarKey];
    [botLeft addSubview:self.radarLabel];
    [botLeft addSubview:self.rivalSplitLabel];
    [botLeft addSubview:gfKey];
    [botLeft addSubview:self.gforceLabel];
    [botLeft addSubview:slipKey];
    [botLeft addSubview:self.slipstreamLabel];
    [botLeft addSubview:draftKey];
    [root addSubview:botLeft];

    // 5. Bottom-Center: Surface Pill (`.hud-bc` / `.hud-surface-pill` in `arena_winio.json`)
    NSVisualEffectView *botCenter = makeHudPanel(NSMakeRect((W - 404) * 0.5, 20, 404, 30), 15.0);
    botCenter.autoresizingMask = NSViewMinXMargin | NSViewMaxXMargin | NSViewMaxYMargin;
    self.surfacePillLabel = makeHudLabel(
        @"SURFACE: DRY ASPHALT  ·  TRACTION: 100%  ·  WEATHER: SUNSET",
        9.5, NSFontWeightBold, [NSColor colorWithWhite:0.86 alpha:1.0], NSTextAlignmentCenter
    );
    self.surfacePillLabel.frame = NSMakeRect(10, 7, 384, 15);
    [botCenter addSubview:self.surfacePillLabel];
    [root addSubview:botCenter];

    // 6. Bottom-Right: VELOCITY, GEAR LOW/HIGH, 16-LED TACHOMETER & NITRO ×3 BAR (`.hud-br` in `arena_winio.json`)
    NSVisualEffectView *botRight = makeHudPanel(NSMakeRect(W - 400, 20, 380, 142), 12.0);
    botRight.autoresizingMask = NSViewMinXMargin | NSViewMaxYMargin;

    NSTextField *veloHdr = makeHudLabel(@"VELOCITY", 10.0, NSFontWeightBold, [NSColor colorWithWhite:0.72 alpha:1.0], NSTextAlignmentLeft);
    veloHdr.frame = NSMakeRect(16, 116, 90, 14);
    self.veloModeLabel = makeHudLabel(
        [self winioTextForLayer:@"velo-mode" fallback:@"IDLE"],
        10.5, NSFontWeightHeavy, [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0], NSTextAlignmentRight
    );
    self.veloModeLabel.frame = NSMakeRect(110, 116, 102, 14);

    self.speedLabel = makeHudLabel(
        [self winioTextForLayer:@"speed" fallback:@"0"],
        42.0, NSFontWeightHeavy, [NSColor whiteColor], NSTextAlignmentLeft
    );
    self.speedLabel.frame = NSMakeRect(16, 68, 128, 46);
    NSTextField *kmhUnit = makeHudLabel(@"KM/H", 11.0, NSFontWeightBold, [NSColor colorWithWhite:0.72 alpha:1.0], NSTextAlignmentLeft);
    kmhUnit.frame = NSMakeRect(146, 76, 50, 16);

    // Transmission LOW / HIGH pills
    self.gearLowPill = makeHudLabel(@"LOW", 11.0, NSFontWeightHeavy, [NSColor colorWithRed:1.0 green:0.84 blue:0.28 alpha:1.0], NSTextAlignmentCenter);
    self.gearLowPill.frame = NSMakeRect(226, 96, 64, 22);
    self.gearLowPill.wantsLayer = YES;
    self.gearLowPill.layer.backgroundColor = [NSColor colorWithRed:1.0 green:0.78 blue:0.20 alpha:0.22].CGColor;
    self.gearLowPill.layer.cornerRadius = 5.0;

    self.gearHighPill = makeHudLabel(@"HIGH", 11.0, NSFontWeightHeavy, [NSColor colorWithWhite:0.50 alpha:1.0], NSTextAlignmentCenter);
    self.gearHighPill.frame = NSMakeRect(298, 96, 66, 22);
    self.gearHighPill.wantsLayer = YES;
    self.gearHighPill.layer.backgroundColor = [NSColor colorWithWhite:1.0 alpha:0.08].CGColor;
    self.gearHighPill.layer.cornerRadius = 5.0;

    NSTextField *tachHdr = makeHudLabel(@"TACHOMETER", 9.5, NSFontWeightBold, [NSColor colorWithWhite:0.68 alpha:1.0], NSTextAlignmentLeft);
    tachHdr.frame = NSMakeRect(226, 74, 80, 14);
    self.rpmLabel = makeHudLabel(
        [self winioTextForLayer:@"rpm" fallback:@"1000 RPM"],
        10.5, NSFontWeightBold, [NSColor colorWithWhite:0.88 alpha:1.0], NSTextAlignmentRight
    );
    self.rpmLabel.frame = NSMakeRect(298, 74, 66, 14);

    // 16-segment digital LED tachometer bar
    self.tachoSegmentViews = [NSMutableArray arrayWithCapacity:16];
    for (int i = 0; i < 16; i++) {
        NSView *seg = [[NSView alloc] initWithFrame:NSMakeRect(16 + i * 21.8, 52, 18, 10)];
        seg.wantsLayer = YES;
        seg.layer.cornerRadius = 2.0;
        seg.layer.backgroundColor = [NSColor colorWithWhite:1.0 alpha:0.12].CGColor;
        [botRight addSubview:seg];
        [self.tachoSegmentViews addObject:seg];
    }

    // NITRO ×3 indicator label + 3-cell segmented nitro gauge bar (`hud.js` NITRO colors)
    self.nitroTextLabel = makeHudLabel(
        [self winioTextForLayer:@"nitro-text" fallback:@"NITRO ×3"],
        11.5, NSFontWeightHeavy, [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0], NSTextAlignmentLeft
    );
    self.nitroTextLabel.frame = NSMakeRect(16, 28, 180, 16);
    NSTextField *nitroKeyHint = makeHudLabel(@"[SPACE]", 10.0, NSFontWeightBold, [NSColor colorWithWhite:0.68 alpha:1.0], NSTextAlignmentRight);
    nitroKeyHint.frame = NSMakeRect(240, 28, 124, 16);

    NSView *nitroBg = [[NSView alloc] initWithFrame:NSMakeRect(16, 12, 348, 12)];
    nitroBg.wantsLayer = YES;
    nitroBg.layer.backgroundColor = [NSColor colorWithWhite:1.0 alpha:0.14].CGColor;
    nitroBg.layer.cornerRadius = 6.0;
    nitroBg.layer.borderWidth = 1.0;
    nitroBg.layer.borderColor = [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:0.42].CGColor;

    self.nitroFillView = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 348, 12)];
    self.nitroFillView.wantsLayer = YES;
    self.nitroFillView.layer.backgroundColor = [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:0.96].CGColor;
    self.nitroFillView.layer.cornerRadius = 6.0;
    [nitroBg addSubview:self.nitroFillView];

    // 3-charge cell dividers at 33.3% and 66.7% matching browser .hud-nitro-cells
    for (int c = 1; c <= 2; c++) {
        NSView *div = [[NSView alloc] initWithFrame:NSMakeRect((348.0 / 3.0) * c - 1.0, 0, 2.0, 12.0)];
        div.wantsLayer = YES;
        div.layer.backgroundColor = [NSColor colorWithRed:0.05 green:0.08 blue:0.14 alpha:0.85].CGColor;
        [nitroBg addSubview:div];
    }

    [botRight addSubview:veloHdr];
    [botRight addSubview:self.veloModeLabel];
    [botRight addSubview:self.speedLabel];
    [botRight addSubview:kmhUnit];
    [botRight addSubview:self.gearLowPill];
    [botRight addSubview:self.gearHighPill];
    [botRight addSubview:tachHdr];
    [botRight addSubview:self.rpmLabel];
    [botRight addSubview:self.nitroTextLabel];
    [botRight addSubview:nitroKeyHint];
    [botRight addSubview:nitroBg];
    [root addSubview:botRight];

    // 7. Title Card Modal Overlay (`phase="title"` in `arena_winio.json`)
    self.titleCard = makeHudPanel(NSMakeRect((W - 560) * 0.5, (H - 390) * 0.5, 560, 390), 18.0);
    self.titleCard.autoresizingMask = NSViewMinXMargin | NSViewMaxXMargin | NSViewMinYMargin | NSViewMaxYMargin;

    NSTextField *kicker = makeHudLabel(@"SEGA AM2 · SUPER SCALER · 1986 COASTAL GRAND TOUR", 11.0, NSFontWeightBold, [NSColor colorWithRed:0.38 green:0.86 blue:1.0 alpha:1.0], NSTextAlignmentCenter);
    kicker.frame = NSMakeRect(24, 344, 512, 18);
    NSTextField *title = makeHudLabel(@"APEX OUTRUN", 42.0, NSFontWeightHeavy, [NSColor whiteColor], NSTextAlignmentCenter);
    title.frame = NSMakeRect(24, 292, 512, 50);
    NSTextField *sub = makeHudLabel(@"15-STAGE BRANCHING ROUTE · RIVAL DUEL · SLIPSTREAM TURBO · SYNTHWAVE FM", 11.5, NSFontWeightMedium, [NSColor colorWithWhite:0.82 alpha:1.0], NSTextAlignmentCenter);
    sub.frame = NSMakeRect(24, 266, 512, 20);

    NSButton *startSoloBtn = makeHudButton(
        [self winioTextForId:@"stk-start-btn" fallback:@"INSERT COIN · START SOLO TOUR"],
        self, @selector(onStartSoloClicked:), NSMakeRect(46, 204, 232, 44), [NSColor colorWithRed:0.88 green:0.18 blue:0.20 alpha:1.0]
    );
    NSButton *startDuelBtn = makeHudButton(
        [self winioTextForId:@"stk-duel-btn" fallback:@"STAGE 1 DUEL SPRINT [KEY 2]"],
        self, @selector(onStartDuelClicked:), NSMakeRect(286, 204, 228, 44), [NSColor colorWithRed:0.18 green:0.52 blue:0.86 alpha:1.0]
    );

    NSTextField *radioLbl = makeHudLabel(@"COASTLINE RADIO STATION & MASTER VOLUME:", 11.0, NSFontWeightBold, [NSColor colorWithWhite:0.78 alpha:1.0], NSTextAlignmentCenter);
    radioLbl.frame = NSMakeRect(40, 166, 480, 18);

    NSButton *st0Btn = makeHudButton(@"88.5 Magical Sound", self, @selector(onStation0Clicked:), NSMakeRect(46, 130, 150, 30), [NSColor colorWithWhite:0.25 alpha:1.0]);
    NSButton *st1Btn = makeHudButton(@"92.1 Splash Wave", self, @selector(onStation1Clicked:), NSMakeRect(205, 130, 150, 30), [NSColor colorWithWhite:0.25 alpha:1.0]);
    NSButton *st2Btn = makeHudButton(@"97.3 Passing Breeze", self, @selector(onStation2Clicked:), NSMakeRect(364, 130, 150, 30), [NSColor colorWithWhite:0.25 alpha:1.0]);

    NSSlider *volSlider = [NSSlider sliderWithValue:80.0 minValue:0.0 maxValue:100.0 target:self action:@selector(onVolumeSliderChanged:)];
    volSlider.refusesFirstResponder = YES;
    volSlider.frame = NSMakeRect(120, 92, 320, 24);

    NSTextField *controlsHint = makeHudLabel(@"CONTROLS: W/↑ Throttle · S/↓ Brake · A/D or ←/→ Steer\nShift/Z Drift · Space/X Nitro · G Low/High Gear · R Radio · Esc Pause", 11.5, NSFontWeightMedium, [NSColor colorWithWhite:0.78 alpha:1.0], NSTextAlignmentCenter);
    controlsHint.frame = NSMakeRect(30, 24, 500, 48);

    [self.titleCard addSubview:kicker];
    [self.titleCard addSubview:title];
    [self.titleCard addSubview:sub];
    [self.titleCard addSubview:startSoloBtn];
    [self.titleCard addSubview:startDuelBtn];
    [self.titleCard addSubview:radioLbl];
    [self.titleCard addSubview:st0Btn];
    [self.titleCard addSubview:st1Btn];
    [self.titleCard addSubview:st2Btn];
    [self.titleCard addSubview:volSlider];
    [self.titleCard addSubview:controlsHint];
    [root addSubview:self.titleCard];

    // 8. Pause Card Modal Overlay (`phase="paused"`)
    self.pauseCard = makeHudPanel(NSMakeRect((W - 420) * 0.5, (H - 230) * 0.5, 420, 230), 16.0);
    self.pauseCard.autoresizingMask = NSViewMinXMargin | NSViewMaxXMargin | NSViewMinYMargin | NSViewMaxYMargin;
    self.pauseCard.hidden = YES;
    NSTextField *pauseTitle = makeHudLabel(@"RACE PAUSED", 30.0, NSFontWeightHeavy, [NSColor whiteColor], NSTextAlignmentCenter);
    pauseTitle.frame = NSMakeRect(20, 162, 380, 38);
    NSButton *resumeBtn = makeHudButton(@"RESUME RACE [ESC]", self, @selector(onResumeClicked:), NSMakeRect(80, 96, 260, 42), [NSColor colorWithRed:0.20 green:0.62 blue:0.34 alpha:1.0]);
    NSButton *restartBtn = makeHudButton(@"RESTART AT TITLE", self, @selector(onRestartClicked:), NSMakeRect(80, 38, 260, 42), [NSColor colorWithWhite:0.28 alpha:1.0]);
    [self.pauseCard addSubview:pauseTitle];
    [self.pauseCard addSubview:resumeBtn];
    [self.pauseCard addSubview:restartBtn];
    [root addSubview:self.pauseCard];

    // 9. Result Card Modal Overlay (`phase="result"`)
    self.resultCard = makeHudPanel(NSMakeRect((W - 460) * 0.5, (H - 250) * 0.5, 460, 250), 16.0);
    self.resultCard.autoresizingMask = NSViewMinXMargin | NSViewMaxXMargin | NSViewMinYMargin | NSViewMaxYMargin;
    self.resultCard.hidden = YES;
    NSTextField *resTitle = makeHudLabel(@"RUN COMPLETE", 32.0, NSFontWeightHeavy, [NSColor colorWithRed:1.0 green:0.86 blue:0.28 alpha:1.0], NSTextAlignmentCenter);
    resTitle.frame = NSMakeRect(20, 184, 420, 40);
    self.resultSummaryLabel = makeHudLabel(@"FINAL SCORE: 0", 16.0, NSFontWeightBold, [NSColor whiteColor], NSTextAlignmentCenter);
    self.resultSummaryLabel.frame = NSMakeRect(20, 118, 420, 48);
    NSButton *tryAgainBtn = makeHudButton(@"RACE AGAIN [ENTER]", self, @selector(onStartSoloClicked:), NSMakeRect(100, 42, 260, 44), [NSColor colorWithRed:0.88 green:0.18 blue:0.20 alpha:1.0]);
    [self.resultCard addSubview:resTitle];
    [self.resultCard addSubview:self.resultSummaryLabel];
    [self.resultCard addSubview:tryAgainBtn];
    [root addSubview:self.resultCard];
}

- (void)dispatchWinioAction:(NSString *)action value:(float)value {
    if ([action isEqualToString:@"enter-key"]) {
        if (!self.titleCard.hidden || !self.resultCard.hidden) {
            [self onStartSoloClicked:nil];
        }
        return;
    }
    if ([action isEqualToString:@"start-game"]) {
        [self resetJsSimulationForDuel:NO stageState:@"warmup"];
    } else if ([action isEqualToString:@"start-duel"]) {
        [self resetJsSimulationForDuel:YES stageState:@"warmup"];
    } else if ([action isEqualToString:@"restart-game"]) {
        [self resetJsSimulationForDuel:NO stageState:@"title"];
    }
    apexrun_rust_on_action(action.UTF8String, value);
    [self.window makeFirstResponder:self.metalView];
}

- (void)onStartSoloClicked:(id)sender {
    (void)sender;
    [self dispatchWinioAction:@"start-game" value:0.0f];
}

- (void)onStartDuelClicked:(id)sender {
    (void)sender;
    [self dispatchWinioAction:@"start-duel" value:0.0f];
}

- (void)onPauseClicked:(id)sender {
    (void)sender;
    [self dispatchWinioAction:@"toggle-pause" value:0.0f];
}

- (void)onResumeClicked:(id)sender {
    (void)sender;
    [self dispatchWinioAction:@"resume-game" value:0.0f];
}

- (void)onRestartClicked:(id)sender {
    (void)sender;
    [self dispatchWinioAction:@"restart-game" value:0.0f];
}

- (void)onCycleStationClicked:(id)sender {
    (void)sender;
    [self dispatchWinioAction:@"cycle-station" value:0.0f];
}

- (void)onMuteClicked:(id)sender {
    (void)sender;
    [self dispatchWinioAction:@"toggle-mute" value:0.0f];
}

- (void)onStation0Clicked:(id)sender {
    (void)sender;
    [self dispatchWinioAction:@"select-station-0" value:0.0f];
}

- (void)onStation1Clicked:(id)sender {
    (void)sender;
    [self dispatchWinioAction:@"select-station-1" value:0.0f];
}

- (void)onStation2Clicked:(id)sender {
    (void)sender;
    [self dispatchWinioAction:@"select-station-2" value:0.0f];
}

- (void)onVolumeSliderChanged:(NSSlider *)sender {
    [self dispatchWinioAction:@"set-volume" value:sender.floatValue];
}

- (void)stepSimulationFrameWithAspect:(float)aspect {
    uint32_t mask0 = self.metalView.seat0Mask | self.metalView.latchedSeat0Mask;
    uint32_t mask1 = self.metalView.seat1Mask | self.metalView.latchedSeat1Mask;
    self.metalView.latchedSeat0Mask = 0;
    self.metalView.latchedSeat1Mask = 0;
    int32_t gearMode = self.metalView.manualGearMode;

    // If paused in Winio, do not advance JS ticks
    if (self.latestHud.is_paused) {
        mask0 = 0;
        mask1 = 0;
    }

    JSValueRef args[10];
    args[0] = JSValueMakeNumber(self.jsCtx, mask0);
    args[1] = JSValueMakeNumber(self.jsCtx, mask1);
    args[2] = JSValueMakeNumber(self.jsCtx, gearMode);
    args[3] = JSValueMakeNumber(self.jsCtx, aspect);
    for (int i = 0; i < 6; i++) {
        args[4 + i] = JSValueMakeNumber(self.jsCtx, self.latestHud.eq_bands[i]);
    }

    NSString *statusLine = @"title|coconut-beach|Coconut Beach|0|0|";
    JSValueRef exc = NULL;
    if (!self.latestHud.is_paused) {
        JSValueRef resVal = JSObjectCallAsFunction(self.jsCtx, self.jsStepFn, self.jsNativeObj, 10, args, &exc);
        apexAssertNoJsException(self.jsCtx, exc, "__apexrunNative.step");
        if (resVal && JSValueIsString(self.jsCtx, resVal)) {
            JSStringRef jsStr = JSValueToStringCopy(self.jsCtx, resVal, &exc);
            apexAssertNoJsException(self.jsCtx, exc, "step status string");
            if (jsStr) {
                CFStringRef cfStr = JSStringCopyCFString(kCFAllocatorDefault, jsStr);
                statusLine = (__bridge_transfer NSString *)cfStr;
                JSStringRelease(jsStr);
            }
        }
    }

    size_t poseByteLen = JSObjectGetTypedArrayByteLength(self.jsCtx, self.jsPoseArrayObj, &exc);
    apexAssertNoJsException(self.jsCtx, exc, "__apexrunPoseArray byteLength");
    const float *posePtr = (const float *)JSObjectGetTypedArrayBytesPtr(self.jsCtx, self.jsPoseArrayObj, &exc);
    apexAssertNoJsException(self.jsCtx, exc, "__apexrunPoseArray bytesPtr");
    if (!posePtr || poseByteLen < 186 * sizeof(float)) {
        [NSException raise:@"ApexRunPoseBufferException" format:@"Invalid __apexrunPoseArray buffer (%zu bytes)", poseByteLen];
    }
    memcpy(_latestPose, posePtr, 186 * sizeof(float));

    NSArray<NSString *> *parts = [statusLine componentsSeparatedByString:@"|"];
    NSString *stageState = parts.count > 0 ? parts[0] : @"title";
    NSString *stageId = parts.count > 1 ? parts[1] : @"coconut-beach";
    NSString *trackName = parts.count > 2 ? parts[2] : @"Coconut Beach";
    int32_t offRoad = parts.count > 3 ? [parts[3] intValue] : 0;
    int32_t onCurb = parts.count > 4 ? [parts[4] intValue] : 0;
    NSString *events = parts.count > 5 ? parts[5] : @"";

    // If the player crossed a branching highway fork into a new stage, rebuild & upload the new stage .glb!
    if (stageId.length > 0 && ![stageId isEqualToString:self.currentStageId]) {
        self.currentStageId = stageId;
        [self rebuildAndUploadStage:stageId];
    }

    const GpuVertexC *dynVerts = NULL;
    size_t dynVertCount = 0;
    const uint32_t *dynIndices = NULL;
    size_t dynIndexCount = 0;
    MacHudSnapshotC hudSnap = {0};

    apexrun_rust_sync_frame(
        _latestPose,
        stageState.UTF8String,
        trackName.UTF8String,
        offRoad,
        onCurb,
        events.UTF8String,
        &dynVerts,
        &dynVertCount,
        &dynIndices,
        &dynIndexCount,
        &hudSnap
    );
    self.latestHud = hudSnap;
    [self updateAppKitHudFromSnapshot:&hudSnap offRoad:offRoad onCurb:onCurb];
}

- (void)updateAppKitHudFromSnapshot:(const MacHudSnapshotC *)snap offRoad:(int32_t)offRoad onCurb:(int32_t)onCurb {
    self.titleCard.hidden = (snap->show_title_card == 0);
    self.pauseCard.hidden = (snap->show_pause_card == 0);
    self.resultCard.hidden = (snap->show_result_card == 0);

    // Top-Left (`hud-tl`)
    self.stageLabel.stringValue = [NSString stringWithUTF8String:snap->stage_label];
    self.checkpointPillLabel.stringValue = [NSString stringWithUTF8String:snap->checkpoint_code];
    self.driftLabel.stringValue = [NSString stringWithUTF8String:snap->drift_label];
    int forkMeters = (int)roundf(_latestPose[81]);
    self.forkDistLabel.stringValue = (forkMeters > 0) ? [NSString stringWithFormat:@"%d m", forkMeters] : @"FORK NOW";
    self.routeProgressFillView.frame = NSMakeRect(0, 0, fmax(6.0, 328.0 * snap->route_progress), 8.0);

    // Top-Center (`hud-tc`: Score + TimerSec/TimerDec + Rival Gap)
    int timerSec = (int)roundf(_latestPose[74]);
    int timerDec = (int)roundf(_latestPose[75]);
    self.timerLabel.stringValue = [NSString stringWithFormat:@"%d", timerSec];
    self.timerDecLabel.stringValue = [NSString stringWithFormat:@".%d", abs(timerDec) % 10];
    NSColor *timerCol = (timerSec <= 15)
        ? [NSColor colorWithRed:1.0 green:0.20 blue:0.40 alpha:1.0]
        : [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0];
    self.timerLabel.textColor = timerCol;
    self.timerDecLabel.textColor = timerCol;

    self.rivalHeaderLabel.stringValue = [NSString stringWithUTF8String:snap->rival_header_label];
    self.rivalGapLabel.stringValue = [NSString stringWithUTF8String:snap->rival_gap_label];
    BOOL rivalPassed = (snap->rival_fill >= 0.99f);
    NSColor *rivalCol = rivalPassed
        ? [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0]
        : [NSColor colorWithRed:1.0 green:0.20 blue:0.40 alpha:1.0];
    self.rivalHeaderLabel.textColor = rivalCol;
    self.rivalGapLabel.textColor = rivalCol;
    self.rivalFillView.layer.backgroundColor = rivalCol.CGColor;
    self.rivalFillView.frame = NSMakeRect(0, 0, fmax(6.0, 120.0 * snap->rival_fill), 7.0);
    self.scoreLabel.stringValue = [NSString stringWithUTF8String:snap->score_label];

    // Top-Right (`hud-tr`: 15-node Sega Route Matrix Pyramid + Coastline Radio + 6-band EQ)
    self.matrixForkLabel.stringValue = [NSString stringWithUTF8String:snap->matrix_fork_label];
    int activeIdx = (int)snap->pyramid_node_index;
    if (self.routeMatrixView.activeNodeIndex != activeIdx) {
        self.routeMatrixView.activeNodeIndex = activeIdx;
        [self.routeMatrixView setNeedsDisplay:YES];
    }
    self.branchLeftLabel.stringValue = [NSString stringWithUTF8String:snap->branch_left_label];
    self.branchRightLabel.stringValue = [NSString stringWithUTF8String:snap->branch_right_label];
    self.stationLabel.stringValue = [NSString stringWithUTF8String:snap->station_label];

    for (int i = 0; i < 6 && i < (int)self.eqBarViews.count; i++) {
        NSView *bar = self.eqBarViews[i];
        CGFloat h = fmax(4.0, 52.0 * snap->eq_bands[i]);
        bar.frame = NSMakeRect(245 + i * 16, 10, 11, h);
    }

    // Bottom-Left (`hud-bl`: Radar + Rival Split + G-Force + Slipstream + 4-Seg Draft Stream)
    NSString *radarStr = [NSString stringWithUTF8String:snap->radar_label];
    self.radarLabel.stringValue = radarStr;
    if ([radarStr hasPrefix:@"WARNING"]) {
        self.radarLabel.textColor = [NSColor colorWithRed:1.0 green:0.20 blue:0.40 alpha:1.0];
    } else if ([radarStr hasPrefix:@"TRAFFIC"]) {
        self.radarLabel.textColor = [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0];
    } else {
        self.radarLabel.textColor = [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0];
    }

    NSString *rivalSplitStr = [NSString stringWithUTF8String:snap->rival_label];
    self.rivalSplitLabel.stringValue = rivalSplitStr;
    self.rivalSplitLabel.textColor = [rivalSplitStr hasPrefix:@"LEAD"]
        ? [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0]
        : [NSColor colorWithRed:1.0 green:0.20 blue:0.40 alpha:1.0];

    self.gforceLabel.stringValue = [NSString stringWithUTF8String:snap->gforce_label];
    self.slipstreamLabel.stringValue = [NSString stringWithUTF8String:snap->slipstream_label];
    BOOL slipActive = (_latestPose[79] > 0.5f);
    self.slipstreamLabel.textColor = slipActive
        ? [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0]
        : [NSColor colorWithWhite:0.70 alpha:1.0];
    for (NSView *dseg in self.draftSegViews) {
        dseg.layer.backgroundColor = slipActive
            ? [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:0.92].CGColor
            : [NSColor colorWithWhite:1.0 alpha:0.14].CGColor;
    }

    // Bottom-Center (`hud-bc`: `.hud-surface-pill`)
    if (offRoad != 0) {
        self.surfacePillLabel.stringValue = @"SURFACE: OFF-ROAD VERGE  ·  TRACTION: 62%  ·  SLIP WARNING";
        self.surfacePillLabel.textColor = [NSColor colorWithRed:1.0 green:0.55 blue:0.24 alpha:1.0];
    } else if (onCurb != 0) {
        self.surfacePillLabel.stringValue = @"SURFACE: APEX RUMBLE CURB  ·  TRACTION: 92%  ·  FEEDBACK ACTIVE";
        self.surfacePillLabel.textColor = [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0];
    } else {
        self.surfacePillLabel.stringValue = @"SURFACE: DRY ASPHALT  ·  TRACTION: 100%  ·  WEATHER: SUNSET";
        self.surfacePillLabel.textColor = [NSColor colorWithWhite:0.86 alpha:1.0];
    }

    // Bottom-Right (`hud-br`: Velocity + Gear Pills + 16-LED Tachometer + Nitro ×3 Bar)
    self.veloModeLabel.stringValue = [NSString stringWithUTF8String:snap->velo_mode_label];
    self.speedLabel.stringValue = [NSString stringWithFormat:@"%d", atoi(snap->speed_label)];
    self.rpmLabel.stringValue = [NSString stringWithUTF8String:snap->rpm_label];

    BOOL isHighGear = (snap->gear >= 2);
    self.gearLowPill.textColor = isHighGear ? [NSColor colorWithWhite:0.50 alpha:1.0] : [NSColor colorWithRed:1.0 green:0.84 blue:0.28 alpha:1.0];
    self.gearLowPill.layer.backgroundColor = isHighGear ? [NSColor colorWithWhite:1.0 alpha:0.08].CGColor : [NSColor colorWithRed:1.0 green:0.78 blue:0.20 alpha:0.24].CGColor;
    self.gearHighPill.textColor = isHighGear ? [NSColor colorWithRed:0.32 green:0.92 blue:1.0 alpha:1.0] : [NSColor colorWithWhite:0.50 alpha:1.0];
    self.gearHighPill.layer.backgroundColor = isHighGear ? [NSColor colorWithRed:0.20 green:0.82 blue:1.0 alpha:0.24].CGColor : [NSColor colorWithWhite:1.0 alpha:0.08].CGColor;

    int litSegs = (int)roundf(snap->tacho_ratio * 16.0f);
    for (int i = 0; i < 16 && i < (int)self.tachoSegmentViews.count; i++) {
        NSView *seg = self.tachoSegmentViews[i];
        if (i < litSegs) {
            if (i >= 13) {
                seg.layer.backgroundColor = [NSColor colorWithRed:1.0 green:0.20 blue:0.40 alpha:0.96].CGColor;
            } else if (i >= 9) {
                seg.layer.backgroundColor = [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:0.95].CGColor;
            } else {
                seg.layer.backgroundColor = [NSColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:0.92].CGColor;
            }
        } else {
            seg.layer.backgroundColor = [NSColor colorWithWhite:1.0 alpha:0.10].CGColor;
        }
    }

    // Exact `hud.js` `NITRO` palette: ready = `#ffd700`, boost = `#4de8ff`, charging = `#78909c`
    self.nitroTextLabel.stringValue = [NSString stringWithUTF8String:snap->nitro_label];
    CGFloat maxNitroW = 348.0;
    self.nitroFillView.frame = NSMakeRect(0, 0, fmax(0.0, maxNitroW * snap->nitro_ratio), 12.0);
    if (snap->nitro_state == 1) {
        // BOOST (`#4de8ff`)
        NSColor *boostCol = [NSColor colorWithRed:0.30 green:0.91 blue:1.0 alpha:1.0];
        self.nitroTextLabel.textColor = boostCol;
        self.nitroFillView.layer.backgroundColor = boostCol.CGColor;
    } else if (snap->nitro_state == 0) {
        // READY (`#ffd700`)
        NSColor *readyCol = [NSColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0];
        self.nitroTextLabel.textColor = readyCol;
        self.nitroFillView.layer.backgroundColor = readyCol.CGColor;
    } else {
        // CHARGING (`#78909c`)
        NSColor *chgCol = [NSColor colorWithRed:0.47 green:0.56 blue:0.61 alpha:1.0];
        self.nitroTextLabel.textColor = chgCol;
        self.nitroFillView.layer.backgroundColor = chgCol.CGColor;
    }

    NSString *bannerStr = [NSString stringWithUTF8String:snap->banner_label];
    self.bannerLabel.stringValue = bannerStr;
    if (bannerStr.length > 10) {
        self.bannerLabel.font = [NSFont monospacedSystemFontOfSize:28.0 weight:NSFontWeightHeavy];
    } else {
        self.bannerLabel.font = [NSFont monospacedSystemFontOfSize:64.0 weight:NSFontWeightHeavy];
    }
    self.resultSummaryLabel.stringValue = [NSString stringWithUTF8String:snap->result_summary];
}

- (void)mtkView:(MTKView *)view drawableSizeWillChange:(CGSize)size {
    (void)view;
    (void)size;
}

- (void)drawInMTKView:(MTKView *)view {
    CGSize sz = view.drawableSize;
    float aspect = (sz.height > 1.0) ? (float)(sz.width / sz.height) : (16.0f / 9.0f);

    [self stepSimulationFrameWithAspect:aspect];

    MTLRenderPassDescriptor *rpd = view.currentRenderPassDescriptor;
    id<CAMetalDrawable> drawable = view.currentDrawable;
    if (!rpd || !drawable) {
        return;
    }

    rpd.colorAttachments[0].loadAction = MTLLoadActionClear;
    rpd.colorAttachments[0].clearColor = MTLClearColorMake(0.11, 0.22, 0.48, 1.0);

    id<MTLCommandBuffer> cmdBuf = [self.commandQueue commandBuffer];

    apexEncodeSceneRenderPass(
        self.device,
        cmdBuf,
        view,
        rpd,
        _latestPose,
        self.currentStageId,
        aspect,
        self.skyPipeline,
        self.skyDepthState,
        self.stagePipeline,
        self.stageDepthState,
        self.skySampler,
        self.groundSampler,
        self.skyTexture,
        self.farBackdropTexture,
        self.midBackdropTexture,
        self.groundTexture,
        self.fallbackTexture,
        self.staticVertexBuffer,
        self.staticIndexBuffer,
        self.staticIndexCount
    );

    id<MTLTexture> drawableTex = (self.autodriveScreenshotDir.length > 0) ? drawable.texture : nil;
    [cmdBuf presentDrawable:drawable];
    [cmdBuf commit];

    if (self.autodriveScreenshotDir.length > 0 && drawableTex) {
        [cmdBuf waitUntilCompleted];
        [self handleAutodriveFrameWithTexture:drawableTex aspect:aspect];
    }
}

typedef struct {
    const char *file_name;
    const char *stage_id;
    float player_z;
    float player_speed;
    int pre_steps;
    uint32_t mask0;
} AutodriveShotC;

static const AutodriveShotC kAutodriveShots[] = {
    { "00_warmup_swoop.png",        "coconut-beach",    0.0f,     0.0f,    45, 0 },
    { "01_coconut_beach.png",       "coconut-beach",    0.0f,     0.0f,   200, 1 },
    { "02_coconut_beach_nitro.png", "coconut-beach",    6000.0f,  240.0f,  45, 1 | 32 },
    { "03_coconut_beach_fork.png",  "coconut-beach",    63500.0f, 220.0f,  35, 1 },
    { "03b_checkpoint_haze.png",    "coconut-beach",    74000.0f, 230.0f,  85, 1 },
    { "04_gateway_pass_hill.png",   "gateway-pass",     5000.0f,  210.0f,  60, 1 },
    { "05_tulip_gardens.png",       "tulip-gardens",    3000.0f,  210.0f,  60, 1 },
    { "06_metropolis_night.png",    "metropolis-night", 4000.0f,  220.0f,  60, 1 },
};
static const int kAutodriveShotCount = (int)(sizeof(kAutodriveShots) / sizeof(kAutodriveShots[0]));

- (void)prepareAutodriveShot:(int)shotIdx aspect:(float)aspect {
    if (shotIdx < 0 || shotIdx >= kAutodriveShotCount || !self.jsInitStageFn) {
        return;
    }
    AutodriveShotC shot = kAutodriveShots[shotIdx];
    NSString *stageId = [NSString stringWithUTF8String:shot.stage_id];
    JSStringRef stageStr = JSStringCreateWithCFString((__bridge CFStringRef)stageId);
    const char *initState = (shotIdx == 0) ? "warmup" : "racing";
    JSStringRef stateStr = JSStringCreateWithUTF8CString(initState);
    JSValueRef args[5] = {
        JSValueMakeNumber(self.jsCtx, 0x1337),
        JSValueMakeString(self.jsCtx, stageStr),
        JSValueMakeString(self.jsCtx, stateStr),
        JSValueMakeNumber(self.jsCtx, shot.player_z),
        JSValueMakeNumber(self.jsCtx, shot.player_speed)
    };
    JSValueRef exc = NULL;
    JSObjectCallAsFunction(self.jsCtx, self.jsInitStageFn, self.jsNativeObj, 5, args, &exc);
    JSStringRelease(stageStr);
    JSStringRelease(stateStr);
    apexAssertNoJsException(self.jsCtx, exc, "__apexrunNative.initStage");

    apexrun_rust_on_action("start-game", 0.0f);
    if (![self.currentStageId isEqualToString:stageId]) {
        self.currentStageId = stageId;
        [self rebuildAndUploadStage:stageId];
    }
    self.metalView.seat0Mask = shot.mask0;
    self.metalView.latchedSeat0Mask = shot.mask0;
    for (int i = 0; i < shot.pre_steps; i++) {
        self.metalView.seat0Mask = shot.mask0;
        [self stepSimulationFrameWithAspect:aspect];
    }
    self.autodriveWarmupLeft = 2;
}

- (void)saveAutodriveScreenshotFromTexture:(id<MTLTexture>)tex toPath:(NSString *)outPath {
    if (!tex) {
        return;
    }
    size_t texW = tex.width;
    size_t texH = tex.height;
    if (texW == 0 || texH == 0) {
        return;
    }
    uint8_t *rgba = (uint8_t *)calloc(texW * texH * 4, 1);
    if (!rgba) {
        return;
    }
    [tex getBytes:rgba
      bytesPerRow:texW * 4
       fromRegion:MTLRegionMake2D(0, 0, texW, texH)
      mipmapLevel:0];

    // Convert BGRA8 -> RGBA8
    size_t pxCount = texW * texH;
    for (size_t i = 0; i < pxCount; i++) {
        uint8_t b = rgba[i * 4 + 0];
        uint8_t r = rgba[i * 4 + 2];
        rgba[i * 4 + 0] = r;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = 255;
    }

    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    CGContextRef ctx = CGBitmapContextCreate(
        rgba,
        texW,
        texH,
        8,
        texW * 4,
        cs,
        kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big
    );
    CGColorSpaceRelease(cs);
    if (ctx) {
        CGSize viewSz = self.metalView.bounds.size;
        CGFloat scaleX = (viewSz.width > 1.0) ? ((CGFloat)texW / viewSz.width) : 1.0;
        CGFloat scaleY = (viewSz.height > 1.0) ? ((CGFloat)texH / viewSz.height) : 1.0;
        for (NSView *sub in self.metalView.subviews) {
            if (sub.isHidden || sub.bounds.size.width < 1.0 || sub.bounds.size.height < 1.0) {
                continue;
            }
            NSBitmapImageRep *rep = [sub bitmapImageRepForCachingDisplayInRect:sub.bounds];
            if (!rep) {
                continue;
            }
            [sub cacheDisplayInRect:sub.bounds toBitmapImageRep:rep];
            CGImageRef subImg = rep.CGImage;
            if (subImg) {
                NSRect f = sub.frame;
                CGRect dst = CGRectMake(
                    f.origin.x * scaleX,
                    f.origin.y * scaleY,
                    f.size.width * scaleX,
                    f.size.height * scaleY
                );
                CGContextDrawImage(ctx, dst, subImg);
            }
        }
        CGImageRef finalImg = CGBitmapContextCreateImage(ctx);
        if (finalImg) {
            NSURL *url = [NSURL fileURLWithPath:outPath];
            CGImageDestinationRef dest = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.png"), 1, NULL);
            if (dest) {
                CGImageDestinationAddImage(dest, finalImg, NULL);
                CGImageDestinationFinalize(dest);
                CFRelease(dest);
            }
            CGImageRelease(finalImg);
        }
        CGContextRelease(ctx);
    }
    free(rgba);
}

- (void)handleAutodriveFrameWithTexture:(id<MTLTexture>)drawableTex aspect:(float)aspect {
    if (self.autodriveWarmupLeft > 0) {
        self.autodriveWarmupLeft--;
        return;
    }
    if (self.autodriveShotIndex >= 0 && self.autodriveShotIndex < kAutodriveShotCount) {
        [[NSFileManager defaultManager] createDirectoryAtPath:self.autodriveScreenshotDir
                                  withIntermediateDirectories:YES
                                                   attributes:nil
                                                        error:nil];
        NSString *fname = [NSString stringWithUTF8String:kAutodriveShots[self.autodriveShotIndex].file_name];
        NSString *outPath = [self.autodriveScreenshotDir stringByAppendingPathComponent:fname];
        [self saveAutodriveScreenshotFromTexture:drawableTex toPath:outPath];
        self.autodriveShotIndex++;
        if (self.autodriveShotIndex < kAutodriveShotCount) {
            [self prepareAutodriveShot:self.autodriveShotIndex aspect:aspect];
        } else {
            [NSApp terminate:nil];
        }
    }
}

@end

static ApexAppDelegate *sAppDelegate = nil;

void apexrun_macos_run_app(void) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        sAppDelegate = [[ApexAppDelegate alloc] init];
        app.delegate = sAppDelegate;
        [app run];
    }
}
