use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "macos" && target_os != "ios" {
        return;
    }

    let is_ios = target_os == "ios";
    let src_file = if is_ios {
        "src/ios_host.m"
    } else {
        "src/macos_host.m"
    };
    let lib_name = if is_ios { "ios_host" } else { "macos_host" };

    println!("cargo:rerun-if-changed={}", src_file);
    println!("cargo:rerun-if-changed=src/apple_host_common.h");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let obj_path = out_dir.join(format!("{}.o", lib_name));
    let lib_path = out_dir.join(format!("lib{}.a", lib_name));

    let target_triple = env::var("TARGET").unwrap_or_default();
    let is_ios_sim = is_ios && (target_triple.contains("sim") || target_triple.starts_with("x86_64"));
    let sdk_name = if is_ios_sim {
        "iphonesimulator"
    } else if is_ios {
        "iphoneos"
    } else {
        "macosx"
    };

    let dev_dir = env::var("DEVELOPER_DIR").ok().or_else(|| {
        let default_xcode = "/Applications/Xcode.app/Contents/Developer";
        if std::path::Path::new(default_xcode).exists() {
            Some(default_xcode.to_string())
        } else {
            None
        }
    });

    let xcrun = |args: &[&str]| -> String {
        let mut c = Command::new("xcrun");
        if let Some(ref d) = dev_dir {
            c.env("DEVELOPER_DIR", d);
        }
        let out = c
            .args(args)
            .output()
            .unwrap_or_else(|e| panic!("Failed to execute xcrun {:?}: {}", args, e));
        if !out.status.success() {
            panic!(
                "xcrun {:?} failed: {}",
                args,
                String::from_utf8_lossy(&out.stderr)
            );
        }
        String::from_utf8(out.stdout)
            .expect("xcrun output not UTF-8")
            .trim()
            .to_string()
    };

    let xcode_sdk = env::var("SDKROOT")
        .ok()
        .filter(|s| !s.is_empty() && std::path::Path::new(s).exists())
        .unwrap_or_else(|| xcrun(&["--sdk", sdk_name, "--show-sdk-path"]));
    let clang_bin = xcrun(&["--sdk", sdk_name, "--find", "clang"]);
    let ar_bin = xcrun(&["--sdk", sdk_name, "--find", "ar"]);

    let mut cmd = Command::new(&clang_bin);
    if let Some(ref d) = dev_dir {
        cmd.env("DEVELOPER_DIR", d);
    }
    cmd.arg("-c")
        .arg("-fobjc-arc")
        .arg("-O2")
        .arg("-Wall")
        .arg("-Wno-deprecated-declarations")
        .arg("-isysroot")
        .arg(&xcode_sdk);
    if is_ios {
        let clang_target = if target_triple.starts_with("x86_64") {
            "x86_64-apple-ios17.0-simulator"
        } else if is_ios_sim {
            "arm64-apple-ios17.0-simulator"
        } else {
            "arm64-apple-ios17.0"
        };
        cmd.arg("-target").arg(clang_target);
    }
    cmd.arg(src_file).arg("-o").arg(&obj_path);

    let status = cmd
        .status()
        .unwrap_or_else(|_| panic!("Failed to invoke clang for {}", src_file));
    if !status.success() {
        panic!("clang failed to compile {}", src_file);
    }

    let mut ar_cmd = Command::new(&ar_bin);
    if let Some(ref d) = dev_dir {
        ar_cmd.env("DEVELOPER_DIR", d);
    }
    let ar_status = ar_cmd
        .arg("rcs")
        .arg(&lib_path)
        .arg(&obj_path)
        .status()
        .expect("Failed to invoke ar");
    if !ar_status.success() {
        panic!("ar failed to archive {}", lib_path.display());
    }

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static={}", lib_name);
    println!("cargo:rustc-link-arg=-Wl,-syslibroot,{}", xcode_sdk);
    let ui_fw = if is_ios { "UIKit" } else { "AppKit" };
    println!("cargo:rustc-link-lib=framework={}", ui_fw);
    for fw in [
        "Foundation",
        "CoreFoundation",
        "CoreGraphics",
        "ImageIO",
        "Metal",
        "MetalKit",
        "QuartzCore",
        "AudioToolbox",
        "JavaScriptCore",
    ] {
        println!("cargo:rustc-link-lib=framework={}", fw);
    }
}
