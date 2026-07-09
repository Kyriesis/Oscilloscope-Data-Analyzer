using System;
using System.Runtime.InteropServices;
using System.Text;
using static WDF2CSV.Form;

namespace WDF2CSV
{
    internal class WDFAPI
    {
        public struct WDFAccessParam
        {
            public uint version;
            public uint trace;
            public uint block;
            public int start;
            public int count;

            public int ppRate;
            public int waveType;
            public int dataType;
            public int cntOut;
            public IntPtr dst;


            public int box;
            public int compMode;
            public int rsv1;
            public int rsv2;
            public int rsv3;
            public int rsv4;
        }
        //Hyeon : Wrapper for WDF Dll loader;
        public enum WDFVDataType
        {
            wdfDataTypeUINT16 = 0x10 /* USHORT_TYP */, /**< 16bit UnSigned Value Type */
            wdfDataTypeSINT16 = 0x11 /* SHORT_TYP  */, /**< 16bit Signed Value Type */
            wdfDataTypeLOGIC16 = 0x14 /* BIT16_TYP  */, /**< Logic 16bit(UnSigned) Value Type */
            wdfDataTypeUINT32 = 0x20 /* ULONG_TYP  */,
            wdfDataTypeSINT32 = 0x21 /* LONG_TYP   */,
            wdfDataTypeFLOAT = 0x22 /* FLOAT_TYP  */,
            wdfDataTypeLOGIC32 = 0x24 /* BIT32_TYP  */, /**< Logic 32bit(UnSigned) Value Type */
        }

        public enum WDFDefaultValue
        {
            WDF_DEFAULT_ACSPRM_VERSION = 1,      /**< for WDFAccessParam::version */
            WDF_DEFAULT_ACSPRM_PPRATE = 512,    /**< for WDFAccessParam::ppRate */
            WDF_DEFAULT_ACSPRM_WAVETYPE = 0,      /**< for WDFAccessParam::waveType */
            WDF_DEFAULT_ACSPRM_DATATYPE = 0,      /**< for WDFAccessParam::dataType */
            WDF_DEFAULT_ACSPRM_COMPMODE = 0,      /**< for WDFAccessParam::compMode */
        }

        private delegate int WdfOpenFile(out int handle, string fileName);
        private delegate int WdfGetTraceNumber(int handle, out uint traceNumber);
        private delegate int WdfGetVResolution(int handle, uint trace, uint block, out double vResolution);
        private delegate int WdfGetVOffset(int handle, uint trace, uint block, out double vOffset);
        private delegate int WdfGetHOffset(int handle, uint trace, uint block, out double vOffset);
        private delegate int WdfGetBlockSize(int handle, uint trace, uint block, out int blockSize);
        private delegate int WdfGetVDataType(int handle, uint trace, uint block, out WDFVDataType vDataType);
        private delegate int WdfGetTraceName(int handle, uint trace, StringBuilder buff);
        private delegate int WdfGetScaleWave(int handle, out WDFAccessParam param);
        private delegate int WdfCloseFile(out int handle);
        private delegate int WdfGetHResolution(int handle, uint trace, uint block, out double hResolution);
        private delegate int WdfGetVUnit(int handle, uint trace, uint block, StringBuilder buff);
        private delegate int WdfGetHUnit(int handle, uint trace, uint block, StringBuilder buff);
        private delegate int WdfIsEnabledVIllegalData(int handle, uint trace, out int enabled);
        private delegate int WdfGetVIllegalData(int handle, uint trace, uint block, out double vIllegalData);

        private WdfOpenFile           I_openFileEx;
        private WdfGetTraceNumber     I_getTraceNumber;
        private WdfGetVResolution     I_getVResolution;
        private WdfGetVOffset         I_getVOffset;
        private WdfGetHOffset         I_getHOffset;
        private WdfGetBlockSize       I_getBlockSize;
        private WdfGetVDataType     I_getVDataType;
        private WdfGetTraceName       I_getTraceName;
        private WdfGetScaleWave       I_getScaleWave;
        private WdfCloseFile          I_closeFile;
        private WdfGetHResolution     I_getHResolution;
        private WdfGetVUnit           I_getVUnit;
        private WdfGetHUnit           I_getHUnit;
        private WdfIsEnabledVIllegalData? I_isEnabledVIllegalData;
        private WdfGetVIllegalData?       I_getVIllegalData;

        private IntPtr dllHandle;

        public bool isLoaded { get; private set; }

        public WDFAPI()
        {
            isLoaded = false;
        }

        ~WDFAPI()
        {
            if (isLoaded)
                FreeLibrary(dllHandle);
        }

        public void tryLoadDLL(string dllPath)
        {

            dllHandle = LoadLibrary(dllPath);

            if(dllHandle == IntPtr.Zero)
            {
                isLoaded = false;
                throw new DllNotFoundException("Failed to load DLL");
            }
            IntPtr funcPtr;
            
            funcPtr = GetProcAddress(dllHandle, "WdfOpenFile");
            I_openFileEx = (WdfOpenFile)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfOpenFile));

            funcPtr = GetProcAddress(dllHandle, "WdfGetTraceNumber");
            I_getTraceNumber = (WdfGetTraceNumber)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetTraceNumber));
            
            funcPtr = GetProcAddress(dllHandle, "WdfGetVResolution");
            I_getVResolution = (WdfGetVResolution)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetVResolution));
            
            funcPtr = GetProcAddress(dllHandle, "WdfGetVOffset");
            I_getVOffset = (WdfGetVOffset)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetVOffset));

            funcPtr = GetProcAddress(dllHandle, "WdfGetHOffset");
            I_getHOffset = (WdfGetHOffset)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetHOffset));

            funcPtr = GetProcAddress(dllHandle, "WdfGetBlockSize");
            I_getBlockSize = (WdfGetBlockSize)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetBlockSize));
            
            funcPtr = GetProcAddress(dllHandle, "WdfGetScaleWave");
            I_getScaleWave = (WdfGetScaleWave)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetScaleWave));
            
            funcPtr = GetProcAddress(dllHandle, "WdfCloseFile");
            I_closeFile = (WdfCloseFile)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfCloseFile));

            funcPtr = GetProcAddress(dllHandle, "WdfGetHResolution");
            I_getHResolution = (WdfGetHResolution)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetHResolution));

            funcPtr = GetProcAddress(dllHandle, "WdfGetTraceName");
            I_getTraceName = (WdfGetTraceName)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetTraceName));

            funcPtr = GetProcAddress(dllHandle, "WdfGetVUnit");
            I_getVUnit= (WdfGetVUnit)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetVUnit));

            funcPtr = GetProcAddress(dllHandle, "WdfGetHUnit");
            I_getHUnit = (WdfGetHUnit)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetHUnit));
            
            funcPtr = GetProcAddress(dllHandle, "WdfGetVDataType");
            I_getVDataType = (WdfGetVDataType)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetVDataType));

            // Optional: only available on some DLLs (e.g. DL850E/DL350)
            funcPtr = GetProcAddress(dllHandle, "WdfIsEnabledVIllegalData");
            if (funcPtr != IntPtr.Zero)
                I_isEnabledVIllegalData = (WdfIsEnabledVIllegalData)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfIsEnabledVIllegalData));

            funcPtr = GetProcAddress(dllHandle, "WdfGetVIllegalData");
            if (funcPtr != IntPtr.Zero)
                I_getVIllegalData = (WdfGetVIllegalData)Marshal.GetDelegateForFunctionPointer(funcPtr, typeof(WdfGetVIllegalData));

            isLoaded = true;
        }

        public int openFileEx(out int handle, string fileName)
        {
            checkIsDLLLoaded();
            return I_openFileEx(out handle, fileName);
        }

        public int getTraceNumber(int handle, out uint traceNumber)
        {
            checkIsDLLLoaded();
            return I_getTraceNumber(handle, out traceNumber);
        }
        public int getVResolution(int handle, uint trace, uint block, out double vResolution)
        {
            checkIsDLLLoaded();
            return I_getVResolution(handle, trace, block, out vResolution);
        }
        public int getVOffset(int handle, uint trace, uint block, out double vOffset)
        {
            checkIsDLLLoaded();
            return I_getVOffset(handle, trace, block, out vOffset);
        }
        public int getHOffset(int handle, uint trace, uint block, out double hOffset)
        {
            checkIsDLLLoaded();
            return I_getHOffset(handle, trace, block, out hOffset);
        }

        public int getBlockSize(int handle, uint trace, uint block, out int blockSize)
        {
            checkIsDLLLoaded();
            return I_getBlockSize(handle, trace, block, out blockSize);
        }

        public int getVDataType()
        {
            checkIsDLLLoaded();
            return 0;
        }
        public int getTraceName(int handle, uint trace, StringBuilder buff)
        {
            checkIsDLLLoaded();
            buff.Clear();
            return I_getTraceName(handle, trace, buff);
        }

        public int getScaleWave(int handle, out WDFAccessParam param)
        {
            checkIsDLLLoaded();
            return I_getScaleWave(handle, out param);
        }
        public int closeFile(out int handle)
        {
            checkIsDLLLoaded();
            return I_closeFile(out handle);
        }
        public int getHResolution(int handle, uint trace, uint block, out double hResolution)
        {
            checkIsDLLLoaded();
            return I_getHResolution(handle, trace, block, out hResolution);
        }
        public int getVUnit(int handle, uint trace, uint block, StringBuilder buff)
        {
            checkIsDLLLoaded();
            return I_getVUnit(handle, trace, block, buff);
        }
        public int getHUnit(int handle, uint trace, uint block, StringBuilder buff)
        {
            checkIsDLLLoaded();
            return I_getHUnit(handle, trace, block, buff);
        }

        public int getVDataType(int handle, uint trace, uint block, out WDFVDataType vDataType)
        {
            checkIsDLLLoaded();
            return I_getVDataType(handle, trace, block, out vDataType);
        }

        public bool isVIllegalDataSupported()
        {
            return I_isEnabledVIllegalData != null && I_getVIllegalData != null;
        }

        public int getVIllegalDataEnabled(int handle, uint trace, out bool enabled)
        {
            checkIsDLLLoaded();
            enabled = false;
            if (I_isEnabledVIllegalData == null) return 0;
            int result = I_isEnabledVIllegalData(handle, trace, out int en);
            enabled = en != 0;
            return result;
        }

        public int getVIllegalData(int handle, uint trace, uint block, out double vIllegalData)
        {
            checkIsDLLLoaded();
            vIllegalData = 0;
            if (I_getVIllegalData == null) return 0;
            return I_getVIllegalData(handle, trace, block, out vIllegalData);
        }

        private void checkIsDLLLoaded()
        {
            if (isLoaded == false) throw new DllNotFoundException("Failed to invoke function, DLL not loaded");
        }



        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern IntPtr LoadLibrary(string lpFileName);
        [DllImport("kernel32", SetLastError = true)]
        internal static extern bool FreeLibrary(IntPtr hModule);
        [DllImport("kernel32", CharSet = CharSet.Ansi, SetLastError = true, ExactSpelling = false)]
        internal static extern IntPtr GetProcAddress(IntPtr hModule, string lpProcName);
    }

}
