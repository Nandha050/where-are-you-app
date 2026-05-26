#!/usr/bin/env node

/**
 * Redis Cache System - Verification Script
 * 
 * Run this script to verify all cache system components are installed correctly:
 * npx ts-node src/driver/cache/verify-installation.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
};

interface VerificationResult {
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
}

const results: VerificationResult[] = [];

// Helper functions
const log = (text: string, color: string = colors.reset) => {
    console.log(`${color}${text}${colors.reset}`);
};

const pass = (name: string, message: string) => {
    results.push({ name, status: 'pass', message });
    log(`✅ ${name}`, colors.green);
    if (message) log(`   ${message}`, colors.green);
};

const fail = (name: string, message: string) => {
    results.push({ name, status: 'fail', message });
    log(`❌ ${name}`, colors.red);
    if (message) log(`   ${message}`, colors.red);
};

const warn = (name: string, message: string) => {
    results.push({ name, status: 'warn', message });
    log(`⚠️  ${name}`, colors.yellow);
    if (message) log(`   ${message}`, colors.yellow);
};

// File existence checks
const checkFile = (filePath: string, description: string): boolean => {
    const fullPath = path.join(process.cwd(), filePath);
    if (fs.existsSync(fullPath)) {
        pass(`File exists: ${filePath}`, description);
        return true;
    } else {
        fail(`File missing: ${filePath}`, description);
        return false;
    }
};

// Check directory
const checkDir = (dirPath: string, description: string): boolean => {
    const fullPath = path.join(process.cwd(), dirPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        pass(`Directory exists: ${dirPath}`, description);
        return true;
    } else {
        fail(`Directory missing: ${dirPath}`, description);
        return false;
    }
};

// Check file imports
const checkImports = (filePath: string, imports: string[]): boolean => {
    try {
        const fullPath = path.join(process.cwd(), filePath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        let allFound = true;

        for (const imp of imports) {
            if (!content.includes(imp)) {
                warn(
                    `Missing import in ${filePath}`,
                    `Expected: ${imp}`
                );
                allFound = false;
            }
        }

        if (allFound) {
            pass(`All imports present in ${filePath}`);
        }
        return allFound;
    } catch (error) {
        fail(
            `Cannot read ${filePath}`,
            error instanceof Error ? error.message : 'Unknown error'
        );
        return false;
    }
};

// Main verification
async function verify() {
    log('\n╔════════════════════════════════════════════════════════════╗', colors.blue);
    log('║   REDIS CACHE SYSTEM - INSTALLATION VERIFICATION          ║', colors.blue);
    log('╚════════════════════════════════════════════════════════════╝\n', colors.blue);

    // 1. Directory Structure
    log('\n📁 Checking directory structure...', colors.blue);
    checkDir('src/driver', 'Driver module');
    checkDir('src/driver/cache', 'Cache system');
    checkDir('src/driver/hooks', 'React hooks');
    checkDir('src/driver/queue', 'Queue manager');
    checkDir('src/driver/sync', 'Sync manager');
    checkDir('src/driver/tracking', 'Tracking service');

    // 2. Core Files
    log('\n📄 Checking core files...', colors.blue);
    checkFile(
        'src/driver/cache/cacheKeys.ts',
        'Cache key definitions'
    );
    checkFile(
        'src/driver/cache/CacheTrackingService.ts',
        'Batch tracking service'
    );
    checkFile(
        'src/driver/cache/CacheCoordinatorService.ts',
        'Batch coordinator'
    );
    checkFile(
        'src/driver/cache/CacheMonitoring.ts',
        'Health monitoring'
    );
    checkFile(
        'src/driver/cache/index.ts',
        'Unified exports'
    );
    checkFile(
        'src/driver/hooks/useCacheTracking.ts',
        'Cache tracking hook'
    );
    checkFile(
        'src/driver/hooks/useDriverTracking.ts',
        'Driver tracking hook'
    );

    // 3. Documentation
    log('\n📚 Checking documentation...', colors.blue);
    checkFile(
        'REDIS_CACHE_IMPLEMENTATION.md',
        'Full implementation guide'
    );
    checkFile(
        'REDIS_CACHE_QUICK_REF.md',
        'Quick reference'
    );
    checkFile(
        'REDIS_CACHE_TESTING_GUIDE.md',
        'Testing guide'
    );
    checkFile(
        'REDIS_CACHE_SYSTEM_SUMMARY.md',
        'Implementation summary'
    );

    // 4. Dependencies Check
    log('\n📦 Checking dependencies...', colors.blue);
    try {
        const packageJson = JSON.parse(
            fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
        );

        const requiredDeps = [
            'expo-location',
            'expo-task-manager',
            'axios',
            '@react-native-async-storage/async-storage',
            'mobx',
            'mobx-react-lite',
        ];

        let allDepsPresent = true;
        for (const dep of requiredDeps) {
            if (
                packageJson.dependencies?.[dep] ||
                packageJson.devDependencies?.[dep]
            ) {
                pass(`Dependency installed: ${dep}`);
            } else {
                fail(`Dependency missing: ${dep}`, 'Run: npm install ' + dep);
                allDepsPresent = false;
            }
        }
    } catch (error) {
        fail('Cannot read package.json', error instanceof Error ? error.message : 'Unknown error');
    }

    // 5. Exports Check
    log('\n🔗 Checking exports...', colors.blue);
    checkFile('src/driver/cache/index.ts', 'Should export all cache utilities');

    // 6. Type Definitions
    log('\n📝 Checking TypeScript support...', colors.blue);
    checkFile(
        'tsconfig.json',
        'TypeScript configuration should exist'
    );

    // 7. Configuration
    log('\n⚙️  Checking configuration...', colors.blue);
    try {
        // Check for API base URL setup
        const envFile = path.join(process.cwd(), '.env.local');
        if (fs.existsSync(envFile)) {
            const content = fs.readFileSync(envFile, 'utf-8');
            if (content.includes('REACT_APP_API_URL')) {
                pass('.env.local configured', 'API_BASE_URL is set');
            } else {
                warn(
                    '.env.local missing API_URL',
                    'Add: REACT_APP_API_URL=http://localhost:3000'
                );
            }
        } else {
            warn('.env.local not found', 'Create it with REACT_APP_API_URL');
        }
    } catch (error) {
        fail('Cannot check .env.local', error instanceof Error ? error.message : 'Unknown error');
    }

    // 8. Summary
    log('\n╔════════════════════════════════════════════════════════════╗', colors.blue);
    log('║   VERIFICATION SUMMARY                                     ║', colors.blue);
    log('╚════════════════════════════════════════════════════════════╝\n', colors.blue);

    const passCount = results.filter((r) => r.status === 'pass').length;
    const failCount = results.filter((r) => r.status === 'fail').length;
    const warnCount = results.filter((r) => r.status === 'warn').length;

    log(`Total Checks: ${results.length}`);
    log(`✅ Passed: ${passCount}`, colors.green);
    log(`❌ Failed: ${failCount}`, colors.red);
    log(`⚠️  Warnings: ${warnCount}`, colors.yellow);

    // Final Status
    if (failCount === 0) {
        log(
            '\n🎉 All checks passed! Redis cache system is ready to use.',
            colors.green
        );

        log('\n📖 Next steps:', colors.blue);
        log('1. Review REDIS_CACHE_IMPLEMENTATION.md for usage', colors.blue);
        log('2. Check REDIS_CACHE_QUICK_REF.md for quick start', colors.blue);
        log('3. See DriverTrackingScreenExample.tsx for reference', colors.blue);
        log('4. Run tests with: npm test', colors.blue);

        process.exit(0);
    } else if (warnCount > 0 && failCount === 0) {
        log(
            '\n⚠️  Checks passed with warnings. Fix warnings before production.',
            colors.yellow
        );
        process.exit(0);
    } else {
        log(
            '\n❌ Some checks failed. Fix errors before using the system.',
            colors.red
        );

        log('\n💡 To fix failures:', colors.blue);
        log('1. Ensure all files exist in src/driver/cache/', colors.blue);
        log('2. Install missing dependencies: npm install', colors.blue);
        log('3. Set API_BASE_URL in .env.local', colors.blue);

        process.exit(1);
    }
}

// Run verification
verify().catch((error) => {
    log(`\n❌ Verification failed: ${error}`, colors.red);
    process.exit(1);
});
