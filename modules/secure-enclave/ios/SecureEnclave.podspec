Pod::Spec.new do |s|
  s.name           = 'SecureEnclave'
  s.version        = '1.0.0'
  s.summary        = 'Secure Enclave P-256 signing and App Attest for ChainSpeed'
  s.homepage       = 'https://github.com/narasim-teja/chainSpeed'
  s.license        = 'MIT'
  s.author         = 'ChainSpeed'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Security', 'LocalAuthentication', 'DeviceCheck', 'CryptoKit'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,swift}'
end
