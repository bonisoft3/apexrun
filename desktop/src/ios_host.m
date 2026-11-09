#import <UIKit/UIKit.h>
#import "apple_host_common.h"

static UILabel *makeIOSHudLabel(NSString *text, CGFloat size, UIFontWeight weight, UIColor *color, NSTextAlignment align) {
    UILabel *lbl = [[UILabel alloc] initWithFrame:CGRectZero];
    lbl.text = text ?: @"";
    lbl.font = [UIFont monospacedSystemFontOfSize:size weight:weight];
    lbl.textColor = color;
    lbl.textAlignment = align;
    lbl.backgroundColor = [UIColor clearColor];
    return lbl;
}

static UIView *makeIOSHudPanel(CGRect frame, CGFloat cornerRadius) {
    UIView *panel = [[UIView alloc] initWithFrame:frame];
    panel.backgroundColor = [UIColor colorWithRed:0.05 green:0.07 blue:0.12 alpha:0.78];
    panel.layer.cornerRadius = cornerRadius;
    panel.layer.masksToBounds = YES;
    panel.layer.borderWidth = 1.0;
    panel.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.18].CGColor;
    return panel;
}

static UIButton *makeIOSHudButton(NSString *title, id target, SEL action, CGRect frame, UIColor *accent) {
    UIButton *btn = [UIButton buttonWithType:UIButtonTypeCustom];
    btn.frame = frame;
    [btn setTitle:title forState:UIControlStateNormal];
    [btn setTitleColor:[UIColor whiteColor] forState:UIControlStateNormal];
    btn.titleLabel.font = [UIFont monospacedSystemFontOfSize:12.0 weight:UIFontWeightBold];
    btn.backgroundColor = [accent colorWithAlphaComponent:0.88];
    btn.layer.cornerRadius = 8.0;
    btn.layer.borderWidth = 1.0;
    btn.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.25].CGColor;
    [btn addTarget:target action:action forControlEvents:UIControlEventTouchUpInside];
    return btn;
}

@interface ApexIOSViewController : UIViewController <MTKViewDelegate>
@property (nonatomic, strong) MTKView *metalView;
@property (nonatomic, strong) id<MTLDevice> device;
@property (nonatomic, strong) id<MTLCommandQueue> commandQueue;
@property (nonatomic, strong) id<MTLRenderPipelineState> skyPipeline;
@property (nonatomic, strong) id<MTLDepthStencilState> skyDepthState;
@property (nonatomic, strong) id<MTLRenderPipelineState> stagePipeline;
@property (nonatomic, strong) id<MTLDepthStencilState> stageDepthState;
@property (nonatomic, strong) id<MTLSamplerState> skySampler;
@property (nonatomic, strong) id<MTLSamplerState> groundSampler;
@property (nonatomic, strong) id<MTLTexture> skyTexture;
@property (nonatomic, strong) id<MTLTexture> farBackdropTexture;
@property (nonatomic, strong) id<MTLTexture> midBackdropTexture;
@property (nonatomic, strong) id<MTLTexture> groundTexture;
@property (nonatomic, strong) id<MTLTexture> fallbackTexture;
@property (nonatomic, strong) NSMutableDictionary<NSString *, id<MTLTexture>> *textureCache;
@property (nonatomic, strong) id<MTLBuffer> staticVertexBuffer;
@property (nonatomic, strong) id<MTLBuffer> staticIndexBuffer;
@property (nonatomic, assign) NSUInteger staticIndexCount;
@property (nonatomic, copy) NSString *currentStageId;

@property (nonatomic, assign) JSGlobalContextRef jsCtx;
@property (nonatomic, assign) JSObjectRef jsNativeObj;
@property (nonatomic, assign) JSObjectRef jsStepFn;
@property (nonatomic, assign) JSObjectRef jsInitFn;
@property (nonatomic, assign) JSObjectRef jsInitStageFn;
@property (nonatomic, assign) JSObjectRef jsBuildGlbFn;
@property (nonatomic, assign) JSObjectRef jsPoseArrayObj;

@property (nonatomic, assign) uint32_t touchControlMask;
@property (nonatomic, assign) uint32_t keyboardControlMask;
@property (nonatomic, assign) uint32_t latchedControlMask;
@property (nonatomic, assign) int32_t manualGearMode;
@property (nonatomic, assign) MacHudSnapshotC latestHud;

// HUD overlay widgets
@property (nonatomic, strong) UILabel *stageLabel;
@property (nonatomic, strong) UILabel *driftLabel;
@property (nonatomic, strong) UIView *routeProgressFillView;
@property (nonatomic, strong) UILabel *timerLabel;
@property (nonatomic, strong) UILabel *timerDecLabel;
@property (nonatomic, strong) UILabel *scoreLabel;
@property (nonatomic, strong) UILabel *rivalGapLabel;
@property (nonatomic, strong) UILabel *forkBannerLabel;
@property (nonatomic, strong) UILabel *stationLabel;
@property (nonatomic, strong) UILabel *speedLabel;
@property (nonatomic, strong) UILabel *gearLabel;
@property (nonatomic, strong) UILabel *nitroTextLabel;
@property (nonatomic, strong) UIView *nitroFillView;
@property (nonatomic, strong) UILabel *bannerLabel;

// Touch arcade controls
@property (nonatomic, strong) UIButton *steerLeftBtn;
@property (nonatomic, strong) UIButton *steerRightBtn;
@property (nonatomic, strong) UIButton *nitroTouchBtn;
@property (nonatomic, strong) UIButton *brakeTouchBtn;

// Modal overlays
@property (nonatomic, strong) UIView *titleCard;
@property (nonatomic, strong) UIView *pauseCard;
@property (nonatomic, strong) UIView *resultCard;
@property (nonatomic, strong) UILabel *resultSummaryLabel;
@end

@implementation ApexIOSViewController {
    float _latestPose[186];
    BOOL _hudBuilt;
}

- (UIInterfaceOrientationMask)supportedInterfaceOrientations {
    return UIInterfaceOrientationMaskLandscape;
}

- (BOOL)prefersStatusBarHidden {
    return YES;
}

- (UIRectEdge)preferredScreenEdgesDeferringSystemGestures {
    return UIRectEdgeAll;
}

- (BOOL)canBecomeFirstResponder {
    return YES;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor blackColor];
    self.view.multipleTouchEnabled = YES;

    const char *sim_js_ptr = NULL;
    size_t sim_js_len = 0;
    if (!apexrun_rust_init(&sim_js_ptr, &sim_js_len)) {
        NSLog(@"Failed to initialize OmnishellDesktopHost on iOS");
        return;
    }

    self.currentStageId = @"coconut-beach";
    [self setupJavaScriptCoreWithSource:sim_js_ptr length:sim_js_len];
    [self setupMetalView];
    [self uploadStaticStageBuffers];
    start_coreaudio_stream();

    NSString *autoShot = [[NSProcessInfo processInfo] environment][@"APEXRUN_IOS_SHOT"];
    if (autoShot.length > 0) {
        [self applyAutodrivePreset:autoShot];
    } else {
        [self stepSimulationFrameWithAspect:16.0f / 9.0f];
    }
}

- (void)applyAutodrivePreset:(NSString *)preset {
    if ([preset isEqualToString:@"solo-start"]) {
        [self onStartSoloTapped];
    } else if ([preset isEqualToString:@"racing"]) {
        [self initStageDirect:@"coconut-beach" state:@"racing" z:0.0f speed:0.0f mask:1 preSteps:200];
    } else if ([preset isEqualToString:@"nitro"]) {
        [self initStageDirect:@"coconut-beach" state:@"racing" z:6000.0f speed:240.0f mask:(1 | 32) preSteps:25];
    } else if ([preset isEqualToString:@"fork"]) {
        [self initStageDirect:@"coconut-beach" state:@"racing" z:63500.0f speed:220.0f mask:1 preSteps:35];
    } else if ([preset isEqualToString:@"checkpoint"]) {
        [self initStageDirect:@"coconut-beach" state:@"racing" z:74000.0f speed:230.0f mask:1 preSteps:85];
    } else if ([preset isEqualToString:@"gateway-pass"]) {
        [self initStageDirect:@"gateway-pass" state:@"racing" z:5000.0f speed:210.0f mask:1 preSteps:60];
    } else if ([preset isEqualToString:@"tulip-gardens"]) {
        [self initStageDirect:@"tulip-gardens" state:@"racing" z:3000.0f speed:210.0f mask:1 preSteps:60];
    } else if ([preset isEqualToString:@"metropolis-night"]) {
        [self initStageDirect:@"metropolis-night" state:@"racing" z:4000.0f speed:220.0f mask:1 preSteps:60];
    }
}

- (void)initStageDirect:(NSString *)stageId state:(NSString *)state z:(float)z speed:(float)speed mask:(uint32_t)mask preSteps:(int)preSteps {
    if (!self.jsInitStageFn) return;
    JSStringRef stageStr = JSStringCreateWithCFString((__bridge CFStringRef)stageId);
    JSStringRef stateStr = JSStringCreateWithCFString((__bridge CFStringRef)state);
    JSValueRef args[5] = {
        JSValueMakeNumber(self.jsCtx, 0x1337),
        JSValueMakeString(self.jsCtx, stageStr),
        JSValueMakeString(self.jsCtx, stateStr),
        JSValueMakeNumber(self.jsCtx, z),
        JSValueMakeNumber(self.jsCtx, speed)
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
    self.touchControlMask = mask;
    self.latchedControlMask = mask;
    for (int i = 0; i < preSteps; i++) {
        self.touchControlMask = mask;
        [self stepSimulationFrameWithAspect:19.5f / 9.0f];
    }
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    [self becomeFirstResponder];
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    if (!_hudBuilt && self.view.bounds.size.width > self.view.bounds.size.height) {
        _hudBuilt = YES;
        [self buildIOSHudAndTouchControls];
        [self updateIOSHudFromSnapshot:&_latestHud];
    }
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

- (void)setupMetalView {
    self.device = MTLCreateSystemDefaultDevice();
    self.commandQueue = [self.device newCommandQueue];

    self.metalView = [[MTKView alloc] initWithFrame:self.view.bounds device:self.device];
    self.metalView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    self.metalView.colorPixelFormat = MTLPixelFormatBGRA8Unorm;
    self.metalView.depthStencilPixelFormat = MTLPixelFormatDepth32Float;
    self.metalView.sampleCount = 1;
    self.metalView.preferredFramesPerSecond = 60;
    self.metalView.multipleTouchEnabled = YES;
    self.metalView.delegate = self;
    [self.view addSubview:self.metalView];

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
    self.manualGearMode = 0;

    if (![self.currentStageId isEqualToString:@"coconut-beach"]) {
        self.currentStageId = @"coconut-beach";
        [self rebuildAndUploadStage:@"coconut-beach"];
    }
}

- (void)buildIOSHudAndTouchControls {
    CGFloat W = self.view.bounds.size.width;
    CGFloat H = self.view.bounds.size.height;
    CGFloat safeLeft = 44.0;
    CGFloat safeRight = 44.0;

    UIColor *goldCol = [UIColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0];
    UIColor *cyanCol = [UIColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0];
    UIColor *coralCol = [UIColor colorWithRed:1.0 green:0.20 blue:0.40 alpha:1.0];

    // 1. Top-Left Stage & Progress Panel
    UIView *tlPanel = makeIOSHudPanel(CGRectMake(safeLeft, 12, 238, 66), 12.0);
    self.stageLabel = makeIOSHudLabel(@"STAGE 1 · COCONUT BEACH", 12.0, UIFontWeightBlack, [UIColor whiteColor], NSTextAlignmentLeft);
    self.stageLabel.adjustsFontSizeToFitWidth = YES;
    self.stageLabel.minimumScaleFactor = 0.85;
    self.stageLabel.frame = CGRectMake(12, 8, 214, 18);
    [tlPanel addSubview:self.stageLabel];

    self.driftLabel = makeIOSHudLabel(@"HIGHWAY CLEAR · 4 LANES", 10.0, UIFontWeightSemibold, cyanCol, NSTextAlignmentLeft);
    self.driftLabel.frame = CGRectMake(12, 28, 206, 14);
    [tlPanel addSubview:self.driftLabel];

    UIView *progTrack = [[UIView alloc] initWithFrame:CGRectMake(12, 48, 206, 7)];
    progTrack.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.14];
    progTrack.layer.cornerRadius = 3.5;
    self.routeProgressFillView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 12, 7)];
    self.routeProgressFillView.backgroundColor = cyanCol;
    self.routeProgressFillView.layer.cornerRadius = 3.5;
    [progTrack addSubview:self.routeProgressFillView];
    [tlPanel addSubview:progTrack];
    [self.view addSubview:tlPanel];

    // 2. Top-Center Score & Timer Panel
    UIView *tcPanel = makeIOSHudPanel(CGRectMake((W - 240) * 0.5, 12, 240, 66), 12.0);
    self.timerLabel = makeIOSHudLabel(@"75", 30.0, UIFontWeightBlack, goldCol, NSTextAlignmentRight);
    self.timerLabel.frame = CGRectMake(10, 8, 72, 34);
    [tcPanel addSubview:self.timerLabel];

    self.timerDecLabel = makeIOSHudLabel(@".0", 16.0, UIFontWeightBold, goldCol, NSTextAlignmentLeft);
    self.timerDecLabel.frame = CGRectMake(83, 18, 30, 20);
    [tcPanel addSubview:self.timerDecLabel];

    self.scoreLabel = makeIOSHudLabel(@"000,000", 15.0, UIFontWeightBlack, [UIColor whiteColor], NSTextAlignmentRight);
    self.scoreLabel.frame = CGRectMake(114, 10, 114, 20);
    [tcPanel addSubview:self.scoreLabel];

    self.rivalGapLabel = makeIOSHudLabel(@"RIVAL +80m", 11.0, UIFontWeightBold, coralCol, NSTextAlignmentRight);
    self.rivalGapLabel.adjustsFontSizeToFitWidth = YES;
    self.rivalGapLabel.minimumScaleFactor = 0.78;
    self.rivalGapLabel.frame = CGRectMake(92, 34, 136, 16);
    [tcPanel addSubview:self.rivalGapLabel];
    [self.view addSubview:tcPanel];

    self.forkBannerLabel = makeIOSHudLabel(@"", 10.0, UIFontWeightBlack, goldCol, NSTextAlignmentCenter);
    self.forkBannerLabel.adjustsFontSizeToFitWidth = YES;
    self.forkBannerLabel.minimumScaleFactor = 0.80;
    self.forkBannerLabel.frame = CGRectMake((W - 410) * 0.5, 82, 410, 22);
    self.forkBannerLabel.backgroundColor = [UIColor colorWithRed:0.06 green:0.08 blue:0.13 alpha:0.84];
    self.forkBannerLabel.layer.cornerRadius = 8.0;
    self.forkBannerLabel.layer.masksToBounds = YES;
    self.forkBannerLabel.layer.borderWidth = 1.0;
    self.forkBannerLabel.layer.borderColor = [goldCol colorWithAlphaComponent:0.45].CGColor;
    self.forkBannerLabel.hidden = YES;
    [self.view addSubview:self.forkBannerLabel];

    // 3. Top-Right Radio & Pause Controls
    UIView *trPanel = makeIOSHudPanel(CGRectMake(W - safeRight - 220, 12, 220, 66), 12.0);
    self.stationLabel = makeIOSHudLabel(@"Magical Sound Shower", 11.0, UIFontWeightBold, goldCol, NSTextAlignmentLeft);
    self.stationLabel.frame = CGRectMake(10, 8, 200, 16);
    [trPanel addSubview:self.stationLabel];

    UIButton *nextBtn = makeIOSHudButton(@"NEXT", self, @selector(onNextStationTapped), CGRectMake(10, 30, 62, 28), [UIColor colorWithWhite:0.22 alpha:1.0]);
    UIButton *muteBtn = makeIOSHudButton(@"MUTE", self, @selector(onMuteTapped), CGRectMake(78, 30, 62, 28), [UIColor colorWithWhite:0.22 alpha:1.0]);
    UIButton *pauseBtn = makeIOSHudButton(@"PAUSE", self, @selector(onPauseTapped), CGRectMake(146, 30, 64, 28), coralCol);
    [trPanel addSubview:nextBtn];
    [trPanel addSubview:muteBtn];
    [trPanel addSubview:pauseBtn];
    [self.view addSubview:trPanel];

    // 4. Bottom-Center Speedometer & Nitro Cluster
    UIView *bcPanel = makeIOSHudPanel(CGRectMake((W - 260) * 0.5, H - 86, 260, 72), 12.0);
    self.speedLabel = makeIOSHudLabel(@"0", 32.0, UIFontWeightBlack, [UIColor whiteColor], NSTextAlignmentRight);
    self.speedLabel.frame = CGRectMake(10, 6, 86, 36);
    [bcPanel addSubview:self.speedLabel];

    UILabel *kmhLbl = makeIOSHudLabel(@"KM/H", 10.0, UIFontWeightBold, cyanCol, NSTextAlignmentLeft);
    kmhLbl.frame = CGRectMake(100, 10, 48, 14);
    [bcPanel addSubview:kmhLbl];

    self.gearLabel = makeIOSHudLabel(@"GEAR HIGH", 11.0, UIFontWeightBlack, goldCol, NSTextAlignmentLeft);
    self.gearLabel.frame = CGRectMake(100, 24, 90, 16);
    [bcPanel addSubview:self.gearLabel];

    self.nitroTextLabel = makeIOSHudLabel(@"NITRO ×3 · READY", 10.0, UIFontWeightBold, goldCol, NSTextAlignmentRight);
    self.nitroTextLabel.frame = CGRectMake(110, 42, 138, 12);
    [bcPanel addSubview:self.nitroTextLabel];

    UIView *nitroTrack = [[UIView alloc] initWithFrame:CGRectMake(12, 56, 236, 8)];
    nitroTrack.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.14];
    nitroTrack.layer.cornerRadius = 4.0;
    self.nitroFillView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 236, 8)];
    self.nitroFillView.backgroundColor = goldCol;
    self.nitroFillView.layer.cornerRadius = 4.0;
    [nitroTrack addSubview:self.nitroFillView];
    [bcPanel addSubview:nitroTrack];
    [self.view addSubview:bcPanel];

    // 5. Center Countdown / Checkpoint Banner
    self.bannerLabel = makeIOSHudLabel(@"", 36.0, UIFontWeightBlack, goldCol, NSTextAlignmentCenter);
    self.bannerLabel.frame = CGRectMake((W - 600) * 0.5, H * 0.25, 600, 48);
    [self.view addSubview:self.bannerLabel];

    // 6. Multi-Touch On-Screen Arcade Controls (Bottom-Left Steer Pad + Bottom-Right Nitro/Brake)
    self.steerLeftBtn = [UIButton buttonWithType:UIButtonTypeCustom];
    self.steerLeftBtn.frame = CGRectMake(safeLeft, H - 118, 96, 98);
    self.steerLeftBtn.backgroundColor = [UIColor colorWithRed:0.08 green:0.12 blue:0.20 alpha:0.68];
    self.steerLeftBtn.layer.cornerRadius = 18.0;
    self.steerLeftBtn.layer.borderWidth = 1.5;
    self.steerLeftBtn.layer.borderColor = [cyanCol colorWithAlphaComponent:0.55].CGColor;
    [self.steerLeftBtn setTitle:@"◀ STEER" forState:UIControlStateNormal];
    self.steerLeftBtn.titleLabel.font = [UIFont monospacedSystemFontOfSize:14.0 weight:UIFontWeightBlack];
    [self.steerLeftBtn addTarget:self action:@selector(onSteerLeftDown) forControlEvents:UIControlEventTouchDown | UIControlEventTouchDragEnter];
    [self.steerLeftBtn addTarget:self action:@selector(onSteerLeftUp) forControlEvents:UIControlEventTouchUpInside | UIControlEventTouchUpOutside | UIControlEventTouchCancel | UIControlEventTouchDragExit];
    [self.view addSubview:self.steerLeftBtn];

    self.steerRightBtn = [UIButton buttonWithType:UIButtonTypeCustom];
    self.steerRightBtn.frame = CGRectMake(safeLeft + 106, H - 118, 96, 98);
    self.steerRightBtn.backgroundColor = [UIColor colorWithRed:0.08 green:0.12 blue:0.20 alpha:0.68];
    self.steerRightBtn.layer.cornerRadius = 18.0;
    self.steerRightBtn.layer.borderWidth = 1.5;
    self.steerRightBtn.layer.borderColor = [cyanCol colorWithAlphaComponent:0.55].CGColor;
    [self.steerRightBtn setTitle:@"STEER ▶" forState:UIControlStateNormal];
    self.steerRightBtn.titleLabel.font = [UIFont monospacedSystemFontOfSize:14.0 weight:UIFontWeightBlack];
    [self.steerRightBtn addTarget:self action:@selector(onSteerRightDown) forControlEvents:UIControlEventTouchDown | UIControlEventTouchDragEnter];
    [self.steerRightBtn addTarget:self action:@selector(onSteerRightUp) forControlEvents:UIControlEventTouchUpInside | UIControlEventTouchUpOutside | UIControlEventTouchCancel | UIControlEventTouchDragExit];
    [self.view addSubview:self.steerRightBtn];

    self.brakeTouchBtn = [UIButton buttonWithType:UIButtonTypeCustom];
    self.brakeTouchBtn.frame = CGRectMake(W - safeRight - 202, H - 118, 96, 98);
    self.brakeTouchBtn.backgroundColor = [coralCol colorWithAlphaComponent:0.72];
    self.brakeTouchBtn.layer.cornerRadius = 18.0;
    self.brakeTouchBtn.layer.borderWidth = 1.5;
    self.brakeTouchBtn.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.35].CGColor;
    [self.brakeTouchBtn setTitle:@"BRAKE\nDRIFT" forState:UIControlStateNormal];
    self.brakeTouchBtn.titleLabel.numberOfLines = 2;
    self.brakeTouchBtn.titleLabel.textAlignment = NSTextAlignmentCenter;
    self.brakeTouchBtn.titleLabel.font = [UIFont monospacedSystemFontOfSize:13.0 weight:UIFontWeightBlack];
    [self.brakeTouchBtn addTarget:self action:@selector(onBrakeDown) forControlEvents:UIControlEventTouchDown | UIControlEventTouchDragEnter];
    [self.brakeTouchBtn addTarget:self action:@selector(onBrakeUp) forControlEvents:UIControlEventTouchUpInside | UIControlEventTouchUpOutside | UIControlEventTouchCancel | UIControlEventTouchDragExit];
    [self.view addSubview:self.brakeTouchBtn];

    self.nitroTouchBtn = [UIButton buttonWithType:UIButtonTypeCustom];
    self.nitroTouchBtn.frame = CGRectMake(W - safeRight - 96, H - 118, 96, 98);
    self.nitroTouchBtn.backgroundColor = [goldCol colorWithAlphaComponent:0.82];
    self.nitroTouchBtn.layer.cornerRadius = 18.0;
    self.nitroTouchBtn.layer.borderWidth = 1.5;
    self.nitroTouchBtn.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.45].CGColor;
    [self.nitroTouchBtn setTitle:@"NITRO\nBOOST" forState:UIControlStateNormal];
    [self.nitroTouchBtn setTitleColor:[UIColor blackColor] forState:UIControlStateNormal];
    self.nitroTouchBtn.titleLabel.numberOfLines = 2;
    self.nitroTouchBtn.titleLabel.textAlignment = NSTextAlignmentCenter;
    self.nitroTouchBtn.titleLabel.font = [UIFont monospacedSystemFontOfSize:13.0 weight:UIFontWeightBlack];
    [self.nitroTouchBtn addTarget:self action:@selector(onNitroDown) forControlEvents:UIControlEventTouchDown | UIControlEventTouchDragEnter];
    [self.nitroTouchBtn addTarget:self action:@selector(onNitroUp) forControlEvents:UIControlEventTouchUpInside | UIControlEventTouchUpOutside | UIControlEventTouchCancel | UIControlEventTouchDragExit];
    [self.view addSubview:self.nitroTouchBtn];

    // 7. Title Card Overlay
    self.titleCard = makeIOSHudPanel(CGRectMake((W - 420) * 0.5, (H - 220) * 0.5, 420, 220), 18.0);
    UILabel *titleMain = makeIOSHudLabel(@"APEX OUTRUN", 30.0, UIFontWeightBlack, goldCol, NSTextAlignmentCenter);
    titleMain.frame = CGRectMake(20, 22, 380, 36);
    [self.titleCard addSubview:titleMain];

    UILabel *titleSub = makeIOSHudLabel(@"KINETIC NATIVE iOS · METAL + COREAUDIO", 12.0, UIFontWeightBold, cyanCol, NSTextAlignmentCenter);
    titleSub.frame = CGRectMake(20, 62, 380, 18);
    [self.titleCard addSubview:titleSub];

    UILabel *titleHint = makeIOSHudLabel(@"TOUCH STEER PAD OR USE ARROW KEYS / WASD + SPACE", 10.0, UIFontWeightSemibold, [UIColor colorWithWhite:0.82 alpha:1.0], NSTextAlignmentCenter);
    titleHint.frame = CGRectMake(20, 92, 380, 16);
    [self.titleCard addSubview:titleHint];

    UIButton *soloBtn = makeIOSHudButton(@"START SOLO TOUR", self, @selector(onStartSoloTapped), CGRectMake(30, 134, 172, 54), coralCol);
    UIButton *duelBtn = makeIOSHudButton(@"STAGE 1 DUEL SPRINT", self, @selector(onStartDuelTapped), CGRectMake(218, 134, 172, 54), [UIColor colorWithRed:0.16 green:0.55 blue:0.95 alpha:1.0]);
    [self.titleCard addSubview:soloBtn];
    [self.titleCard addSubview:duelBtn];
    [self.view addSubview:self.titleCard];

    // 8. Pause Card Overlay
    self.pauseCard = makeIOSHudPanel(CGRectMake((W - 360) * 0.5, (H - 210) * 0.5, 360, 210), 18.0);
    self.pauseCard.hidden = YES;
    UILabel *pauseTitle = makeIOSHudLabel(@"RACE PAUSED", 24.0, UIFontWeightBlack, goldCol, NSTextAlignmentCenter);
    pauseTitle.frame = CGRectMake(20, 20, 320, 30);
    [self.pauseCard addSubview:pauseTitle];

    UIButton *resumeBtn = makeIOSHudButton(@"RESUME RACE", self, @selector(onResumeTapped), CGRectMake(40, 66, 280, 38), cyanCol);
    [resumeBtn setTitleColor:[UIColor blackColor] forState:UIControlStateNormal];
    UIButton *restartBtn = makeIOSHudButton(@"RESTART STAGE", self, @selector(onRestartTapped), CGRectMake(40, 112, 280, 38), goldCol);
    [restartBtn setTitleColor:[UIColor blackColor] forState:UIControlStateNormal];
    UIButton *quitBtn = makeIOSHudButton(@"QUIT TO TITLE", self, @selector(onQuitTapped), CGRectMake(40, 158, 280, 38), coralCol);
    [self.pauseCard addSubview:resumeBtn];
    [self.pauseCard addSubview:restartBtn];
    [self.pauseCard addSubview:quitBtn];
    [self.view addSubview:self.pauseCard];

    // 9. Result Card Overlay
    self.resultCard = makeIOSHudPanel(CGRectMake((W - 380) * 0.5, (H - 200) * 0.5, 380, 200), 18.0);
    self.resultCard.hidden = YES;
    UILabel *resTitle = makeIOSHudLabel(@"RUN COMPLETE", 24.0, UIFontWeightBlack, goldCol, NSTextAlignmentCenter);
    resTitle.frame = CGRectMake(20, 20, 340, 30);
    [self.resultCard addSubview:resTitle];

    self.resultSummaryLabel = makeIOSHudLabel(@"", 13.0, UIFontWeightBold, [UIColor whiteColor], NSTextAlignmentCenter);
    self.resultSummaryLabel.frame = CGRectMake(20, 62, 340, 44);
    self.resultSummaryLabel.numberOfLines = 2;
    [self.resultCard addSubview:self.resultSummaryLabel];

    UIButton *againBtn = makeIOSHudButton(@"PLAY AGAIN", self, @selector(onRestartTapped), CGRectMake(30, 128, 154, 46), coralCol);
    UIButton *menuBtn = makeIOSHudButton(@"MAIN MENU", self, @selector(onQuitTapped), CGRectMake(196, 128, 154, 46), [UIColor colorWithWhite:0.25 alpha:1.0]);
    [self.resultCard addSubview:againBtn];
    [self.resultCard addSubview:menuBtn];
    [self.view addSubview:self.resultCard];
}

// Touch Arcade Control Handlers (Auto-gas bit 0 is engaged whenever driving; BRAKE/DRIFT engages drift when steering or brake when straight)
- (void)onSteerLeftDown {
    self.touchControlMask |= (1u << 0) | (1u << 2);
    self.touchControlMask &= ~(1u << 3);
    if ((self.touchControlMask & (1u << 1)) != 0) {
        self.touchControlMask &= ~(1u << 1);
        self.touchControlMask |= (1u << 4);
    }
}
- (void)onSteerLeftUp {
    self.touchControlMask &= ~(1u << 2);
}
- (void)onSteerRightDown {
    self.touchControlMask |= (1u << 0) | (1u << 3);
    self.touchControlMask &= ~(1u << 2);
    if ((self.touchControlMask & (1u << 1)) != 0) {
        self.touchControlMask &= ~(1u << 1);
        self.touchControlMask |= (1u << 4);
    }
}
- (void)onSteerRightUp {
    self.touchControlMask &= ~(1u << 3);
}
- (void)onNitroDown {
    self.touchControlMask |= (1u << 0) | (1u << 5);
    self.latchedControlMask |= (1u << 0) | (1u << 5);
    if (_latestPose[59] > 0.5f || _latestPose[61] > 0.5f) {
        self.latchedControlMask |= (1u << 6);
    }
}
- (void)onNitroUp {
    self.touchControlMask &= ~(1u << 5);
}
- (void)onBrakeDown {
    if ((self.touchControlMask & ((1u << 2) | (1u << 3))) != 0) {
        self.touchControlMask |= (1u << 0) | (1u << 4);
        self.touchControlMask &= ~(1u << 1);
    } else {
        self.touchControlMask &= ~(1u << 0);
        self.touchControlMask |= (1u << 1);
    }
}
- (void)onBrakeUp {
    self.touchControlMask &= ~((1u << 1) | (1u << 4));
    self.touchControlMask |= (1u << 0);
}

// Hardware Keyboard Support in iOS Simulator (Arrow keys / WASD / Space / Enter / Escape)
- (void)pressesBegan:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    BOOL handled = NO;
    for (UIPress *press in presses) {
        UIKey *key = press.key;
        if (!key) continue;
        UIKeyboardHIDUsage code = key.keyCode;
        if (code == UIKeyboardHIDUsageKeyboardUpArrow || code == UIKeyboardHIDUsageKeyboardW) {
            self.keyboardControlMask |= (1u << 0);
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardDownArrow || code == UIKeyboardHIDUsageKeyboardS) {
            self.keyboardControlMask |= (1u << 1);
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardLeftArrow || code == UIKeyboardHIDUsageKeyboardA) {
            self.keyboardControlMask |= (1u << 2);
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardRightArrow || code == UIKeyboardHIDUsageKeyboardD) {
            self.keyboardControlMask |= (1u << 3);
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardSpacebar || code == UIKeyboardHIDUsageKeyboardX) {
            self.keyboardControlMask |= (1u << 5);
            self.latchedControlMask |= (1u << 5);
            if (_latestPose[59] > 0.5f || _latestPose[61] > 0.5f) {
                self.latchedControlMask |= (1u << 6);
            }
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardLeftShift || code == UIKeyboardHIDUsageKeyboardRightShift || code == UIKeyboardHIDUsageKeyboardZ) {
            self.keyboardControlMask |= (1u << 4);
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardReturnOrEnter) {
            if (self.latestHud.show_title_card) {
                [self onStartSoloTapped];
                handled = YES;
            } else {
                self.keyboardControlMask |= (1u << 6);
                self.latchedControlMask |= (1u << 6);
                handled = YES;
            }
        } else if (code == UIKeyboardHIDUsageKeyboardEscape) {
            [self onPauseTapped];
            handled = YES;
        }
    }
    if (!handled) {
        [super pressesBegan:presses withEvent:event];
    }
}

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    BOOL handled = NO;
    for (UIPress *press in presses) {
        UIKey *key = press.key;
        if (!key) continue;
        UIKeyboardHIDUsage code = key.keyCode;
        if (code == UIKeyboardHIDUsageKeyboardUpArrow || code == UIKeyboardHIDUsageKeyboardW) {
            self.keyboardControlMask &= ~(1u << 0);
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardDownArrow || code == UIKeyboardHIDUsageKeyboardS) {
            self.keyboardControlMask &= ~(1u << 1);
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardLeftArrow || code == UIKeyboardHIDUsageKeyboardA) {
            self.keyboardControlMask &= ~(1u << 2);
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardRightArrow || code == UIKeyboardHIDUsageKeyboardD) {
            self.keyboardControlMask &= ~(1u << 3);
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardSpacebar || code == UIKeyboardHIDUsageKeyboardX) {
            self.keyboardControlMask &= ~(1u << 5);
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardLeftShift || code == UIKeyboardHIDUsageKeyboardRightShift || code == UIKeyboardHIDUsageKeyboardZ) {
            self.keyboardControlMask &= ~(1u << 4);
            handled = YES;
        } else if (code == UIKeyboardHIDUsageKeyboardReturnOrEnter) {
            self.keyboardControlMask &= ~(1u << 6);
            handled = YES;
        }
    }
    if (!handled) {
        [super pressesEnded:presses withEvent:event];
    }
}

// Button Action Handlers
- (void)onStartSoloTapped {
    // Enable auto-throttle on touch mobile start so the player immediately accelerates!
    self.touchControlMask = (1u << 0);
    [self resetJsSimulationForDuel:NO stageState:@"warmup"];
    apexrun_rust_on_action("start-game", 0.0f);
    [self becomeFirstResponder];
}

- (void)onStartDuelTapped {
    self.touchControlMask = (1u << 0);
    [self resetJsSimulationForDuel:YES stageState:@"warmup"];
    apexrun_rust_on_action("start-duel", 0.0f);
    [self becomeFirstResponder];
}

- (void)onPauseTapped {
    apexrun_rust_on_action("toggle-pause", 0.0f);
}

- (void)onResumeTapped {
    apexrun_rust_on_action("resume-game", 0.0f);
}

- (void)onRestartTapped {
    self.touchControlMask = (1u << 0);
    [self resetJsSimulationForDuel:NO stageState:@"warmup"];
    apexrun_rust_on_action("start-game", 0.0f);
}

- (void)onQuitTapped {
    self.touchControlMask = 0;
    [self resetJsSimulationForDuel:NO stageState:@"title"];
    apexrun_rust_on_action("restart-game", 0.0f);
}

- (void)onNextStationTapped {
    apexrun_rust_on_action("cycle-station", 0.0f);
}

- (void)onMuteTapped {
    apexrun_rust_on_action("toggle-mute", 0.0f);
}

- (void)stepSimulationFrameWithAspect:(float)aspect {
    uint32_t mask0 = self.touchControlMask | self.keyboardControlMask | self.latchedControlMask;
    self.latchedControlMask = 0;

    if (self.latestHud.is_paused || self.latestHud.show_title_card || self.latestHud.show_result_card) {
        mask0 = 0;
    }

    JSValueRef args[10];
    args[0] = JSValueMakeNumber(self.jsCtx, mask0);
    args[1] = JSValueMakeNumber(self.jsCtx, 0);
    args[2] = JSValueMakeNumber(self.jsCtx, self.manualGearMode);
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
    if (_hudBuilt) {
        [self updateIOSHudFromSnapshot:&hudSnap];
    }
}

- (void)updateIOSHudFromSnapshot:(const MacHudSnapshotC *)snap {
    self.titleCard.hidden = (snap->show_title_card == 0);
    self.pauseCard.hidden = (snap->show_pause_card == 0);
    self.resultCard.hidden = (snap->show_result_card == 0);

    BOOL hideTouchPads = (snap->show_title_card != 0 || snap->show_pause_card != 0 || snap->show_result_card != 0);
    self.steerLeftBtn.hidden = hideTouchPads;
    self.steerRightBtn.hidden = hideTouchPads;
    self.nitroTouchBtn.hidden = hideTouchPads;
    self.brakeTouchBtn.hidden = hideTouchPads;

    self.stageLabel.text = [NSString stringWithUTF8String:snap->stage_label];
    self.driftLabel.text = [NSString stringWithUTF8String:snap->drift_label];
    self.routeProgressFillView.frame = CGRectMake(0, 0, fmax(6.0, 206.0 * snap->route_progress), 7.0);

    UIColor *goldCol = [UIColor colorWithRed:1.0 green:0.84 blue:0.0 alpha:1.0];
    UIColor *cyanCol = [UIColor colorWithRed:0.0 green:0.90 blue:1.0 alpha:1.0];
    UIColor *coralCol = [UIColor colorWithRed:1.0 green:0.20 blue:0.40 alpha:1.0];
    UIColor *slateCol = [UIColor colorWithRed:0.55 green:0.65 blue:0.75 alpha:1.0];

    int timerSec = (int)roundf(_latestPose[74]);
    int timerDec = (int)roundf(_latestPose[75]);
    self.timerLabel.text = [NSString stringWithFormat:@"%d", timerSec];
    self.timerDecLabel.text = [NSString stringWithFormat:@".%d", abs(timerDec) % 10];
    self.timerLabel.textColor = (timerSec <= 15) ? coralCol : goldCol;
    self.timerDecLabel.textColor = (timerSec <= 15) ? coralCol : goldCol;

    self.scoreLabel.text = [NSString stringWithUTF8String:snap->score_label];
    NSString *rivalHdrStr = [NSString stringWithUTF8String:snap->rival_header_label];
    NSString *rivalGapStr = [NSString stringWithUTF8String:snap->rival_gap_label];
    self.rivalGapLabel.text = [NSString stringWithFormat:@"%@ %@", rivalHdrStr, rivalGapStr];
    BOOL rivalPassed = (snap->rival_fill >= 0.99f || [rivalHdrStr containsString:@"PASSED"]);
    self.rivalGapLabel.textColor = rivalPassed ? cyanCol : coralCol;

    NSString *bLeft = [NSString stringWithUTF8String:snap->branch_left_label];
    NSString *bRight = [NSString stringWithUTF8String:snap->branch_right_label];
    NSString *bFork = [NSString stringWithUTF8String:snap->matrix_fork_label];
    if (!hideTouchPads && bLeft.length > 0 && bRight.length > 0 && ![bFork isEqualToString:@"GOAL AHEAD"]) {
        self.forkBannerLabel.hidden = NO;
        self.forkBannerLabel.text = [NSString stringWithFormat:@"%@  ·  %@  ·  %@", bLeft, bFork, bRight];
    } else {
        self.forkBannerLabel.hidden = YES;
    }

    self.stationLabel.text = [NSString stringWithUTF8String:snap->station_label];
    self.speedLabel.text = [NSString stringWithFormat:@"%d", atoi(snap->speed_label)];
    self.gearLabel.text = (snap->gear >= 2) ? @"GEAR HIGH" : @"GEAR LOW";
    NSString *nitroStr = [NSString stringWithUTF8String:snap->nitro_label];
    self.nitroTextLabel.text = nitroStr;
    if (snap->nitro_state == 1) {
        self.nitroTextLabel.textColor = cyanCol;
        self.nitroFillView.backgroundColor = cyanCol;
    } else if (snap->nitro_state == 0) {
        self.nitroTextLabel.textColor = goldCol;
        self.nitroFillView.backgroundColor = goldCol;
    } else {
        self.nitroTextLabel.textColor = slateCol;
        self.nitroFillView.backgroundColor = slateCol;
    }
    self.nitroFillView.frame = CGRectMake(0, 0, fmax(0.0, 236.0 * snap->nitro_ratio), 8.0);

    NSString *bannerStr = [NSString stringWithUTF8String:snap->banner_label];
    self.bannerLabel.text = bannerStr;
    if (bannerStr.length > 10) {
        self.bannerLabel.font = [UIFont monospacedSystemFontOfSize:20.0 weight:UIFontWeightBlack];
    } else {
        self.bannerLabel.font = [UIFont monospacedSystemFontOfSize:36.0 weight:UIFontWeightBlack];
    }
    self.resultSummaryLabel.text = [NSString stringWithUTF8String:snap->result_summary];
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

    [cmdBuf presentDrawable:drawable];
    [cmdBuf commit];
}

@end

@interface ApexIOSAppDelegate : UIResponder <UIApplicationDelegate>
@property (nonatomic, strong) UIWindow *window;
@end

@implementation ApexIOSAppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    (void)application;
    (void)launchOptions;
    self.window = [[UIWindow alloc] initWithFrame:[[UIScreen mainScreen] bounds]];
    self.window.rootViewController = [[ApexIOSViewController alloc] init];
    [self.window makeKeyAndVisible];
    return YES;
}

@end

void apexrun_macos_run_app(void) {
    @autoreleasepool {
        char *argv[] = { "ApexRun", NULL };
        UIApplicationMain(1, argv, nil, NSStringFromClass([ApexIOSAppDelegate class]));
    }
}
